import { readFile } from 'fs/promises';
import { StringDecoder } from 'string_decoder';
import { Client, ClientChannel, ConnectConfig } from 'ssh2';
import * as vscode from 'vscode';
import { KnownHosts } from './knownHosts';
import { ServerStore } from './servers';
import { ServerDraft, ServerRecord, SessionStatus } from './types';
import { DEFAULT_PORT, normalizeHost, parseAuthMethod, parsePort } from './validate';

const READY_TIMEOUT_MS = 20_000;
/** 测试连接就该快，不给 20 秒慢慢等 */
const TEST_TIMEOUT_MS = 10_000;
/** 定期发 SSH 层心跳，免得链路悄悄断了、面板还挂着一个早已死掉的会话。 */
const KEEPALIVE_INTERVAL_MS = 30_000;
const TERMINAL_TYPE = 'xterm-256color';

export interface SessionEvents {
    onData(sessionId: string, data: string): void;
    onStatus(sessionId: string, status: SessionStatus, detail?: string): void;
}

interface Session {
    /** 所属服务器记录，删除服务器时用来把它的会话一并收掉 */
    serverId: string;
    client: Client;
    stream?: ClientChannel;
    /** 最近一次已知尺寸，连接过程中会被 resize 更新 */
    cols: number;
    rows: number;
    /**
     * 终端输出的解码器。必须用 StringDecoder 而不是 chunk.toString()：
     * 一个中文字符占 3 字节，正好跨在两次 TCP 分包的边界上时，
     * 各自 toString 会解出两个乱码替换符。
     */
    decoder: StringDecoder;
    /** 已经上报过结束了，避免 client/stream 的多个事件重复通知 */
    finished: boolean;
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** 把 ssh2 / Node 抛出的英文错误翻成能看懂的一句中文。 */
export function describeConnectError(error: unknown, server: ServerRecord): string {
    const raw = messageOf(error);
    const target = `${server.username}@${server.host}:${server.port}`;

    if (/ECONNREFUSED/.test(raw)) {
        return `连接 ${target} 被拒绝：对方端口没在监听，或者被防火墙挡了。`;
    }
    if (/ENOTFOUND|EAI_AGAIN/.test(raw)) {
        return `找不到主机 ${server.host}：域名解析失败，检查一下地址拼写或 DNS。`;
    }
    if (/ETIMEDOUT|Timed out while waiting|readyTimeout/i.test(raw)) {
        return `连接 ${target} 超时：网络不通，或者对方没有响应。`;
    }
    if (/All configured authentication methods failed/.test(raw)) {
        return `登录 ${target} 失败：用户名、密码或密钥不对。`;
    }
    if (/Cannot parse privateKey|bad passphrase|integrity check failed/i.test(raw)) {
        return '私钥读不了：文件格式不对，或者 passphrase 错了。';
    }
    return `${raw}（${target}）`;
}

/** ssh-agent 的 socket：优先用配置里写的，否则取环境变量（Windows 走命名管道）。 */
function resolveAgentSocket(configured: string | undefined): string | undefined {
    if (configured) {
        return configured;
    }
    if (process.env.SSH_AUTH_SOCK) {
        return process.env.SSH_AUTH_SOCK;
    }
    return process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined;
}

/**
 * SSH 会话池。一个会话 = 一个 ssh2 Client + 一条 shell 通道，
 * 由 webview 里的一个终端标签对应。
 *
 * 这里只管连接和字节搬运，不碰任何 UI；状态变化通过 SessionEvents 回调出去。
 */
export class SshSessionManager implements vscode.Disposable {
    private readonly sessions = new Map<string, Session>();

    constructor(
        private readonly store: ServerStore,
        private readonly knownHosts: KnownHosts,
        private readonly events: SessionEvents
    ) {}

    async open(sessionId: string, server: ServerRecord, cols: number, rows: number): Promise<void> {
        // 同一个标签重复点连接，忽略后一次
        if (this.sessions.has(sessionId)) {
            return;
        }

        const client = new Client();
        const session: Session = {
            serverId: server.id,
            client,
            cols,
            rows,
            decoder: new StringDecoder('utf8'),
            finished: false
        };
        this.sessions.set(sessionId, session);
        this.events.onStatus(sessionId, 'connecting');

        let config: ConnectConfig;
        try {
            config = {
                host: server.host,
                port: server.port,
                username: server.username,
                readyTimeout: READY_TIMEOUT_MS,
                keepaliveInterval: KEEPALIVE_INTERVAL_MS,
                ...(await this.buildAuth(server))
            };
        } catch (error) {
            this.finish(sessionId, 'error', messageOf(error));
            return;
        }

        // ssh2 默认完全不校验主机密钥，这里补上 TOFU（见 knownHosts.ts）。
        // 同步返回 false 即可拒绝握手，无需回调形式。
        let hostKeyProblem: string | undefined;
        config.hostVerifier = (key: Buffer): boolean => {
            if (this.knownHosts.check(server.host, server.port, key) === 'mismatch') {
                hostKeyProblem =
                    `${server.host}:${server.port} 的主机密钥和上次连接时不一样，` +
                    '可能存在中间人攻击，已断开。如果这台机器确实重装过系统或换过密钥，' +
                    '请删掉这条服务器记录后重新添加。';
                return false;
            }
            return true;
        };

        client.on('ready', () => {
            // pty 选项是 shell() 的第一个参数（ssh2 没有 { pty: true } 这种写法）。
            // cols/rows 用构造时记下的值，pty 必须申请，否则远端不会按窗口大小排版。
            client.shell({ term: TERMINAL_TYPE, cols: session.cols, rows: session.rows }, (err, stream) => {
                if (err) {
                    this.finish(sessionId, 'error', describeConnectError(err, server));
                    return;
                }
                this.attach(sessionId, session, stream);
            });
        });

        client.on('error', (err) => {
            this.finish(sessionId, 'error', hostKeyProblem ?? describeConnectError(err, server));
        });

        // 链路自己断了（网络切换、服务端踢人）也走收摊流程
        client.on('close', () => this.finish(sessionId, 'closed'));

        client.connect(config);
    }

    private attach(sessionId: string, session: Session, stream: ClientChannel): void {
        session.stream = stream;
        this.events.onStatus(sessionId, 'connected');

        // 申请 pty 时带的尺寸可能已经过时（握手期间用户拖过窗口），补一次。
        // 这也顺带解决了「setWindow 在通道 open 前调用会被静默丢弃」的问题。
        stream.setWindow(session.rows, session.cols, 0, 0);

        const pump = (chunk: Buffer) => this.events.onData(sessionId, session.decoder.write(chunk));
        stream.on('data', pump);
        stream.stderr.on('data', pump);

        stream.on('close', () => {
            session.client.end();
            this.finish(sessionId, 'closed');
        });
    }

    /**
     * 按记录的认证方式组装 ssh2 的认证配置。
     *
     * override 是测试连接时传的「表单临时值」：密码框留空 = 用已存的，填了 = 用
     * 临时值覆盖，与保存时的语义一致。正式连接不传 override，全从钥匙串取。
     */
    private async buildAuth(
        server: ServerRecord,
        override?: { password?: string; passphrase?: string }
    ): Promise<ConnectConfig> {
        switch (server.authMethod) {
            case 'privateKey': {
                const keyPath = server.privateKeyPath;
                if (!keyPath) {
                    throw new Error('这台服务器没配私钥文件路径，请在编辑表单里补上。');
                }
                let privateKey: Buffer;
                try {
                    privateKey = await readFile(keyPath);
                } catch {
                    throw new Error(`读不到私钥文件：${keyPath}`);
                }
                // passphrase 留空时 ssh2 需要 undefined，空串会被当成「有密码但不对」
                const passphrase = override?.passphrase || (await this.store.passphrase(server.id));
                return { privateKey, passphrase };
            }

            case 'agent': {
                const socket = resolveAgentSocket(server.agentSocketPath);
                if (!socket) {
                    throw new Error(
                        '没找到 ssh-agent 的 socket。请先启动 ssh-agent，' +
                            '或者在服务器配置里手动填上 agent socket 路径。'
                    );
                }
                return { agent: socket };
            }

            default: {
                const password = override?.password || (await this.store.password(server.id));
                if (password === undefined) {
                    throw new Error('这台服务器还没有存过密码，请在编辑表单里填一次。');
                }
                return { password };
            }
        }
    }

    input(sessionId: string, data: string): void {
        this.sessions.get(sessionId)?.stream?.write(data);
    }

    resize(sessionId: string, cols: number, rows: number): void {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return;
        }
        session.cols = cols;
        session.rows = rows;
        // 通道还没开就是空操作（ssh2 会静默丢弃），所以先把尺寸记下来，
        // attach 时会用这个最新值补发一次。参数顺序是 rows 在前。
        session.stream?.setWindow(rows, cols, 0, 0);
    }

    close(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            this.endClient(session.client);
        }
        this.finish(sessionId, 'closed');
    }

    /** 关掉某台服务器的所有会话。删除服务器记录时用，不留连着一个已删记录的会话。 */
    closeByServer(serverId: string): void {
        for (const [sessionId, session] of this.sessions) {
            if (session.serverId === serverId) {
                this.endClient(session.client);
                this.finish(sessionId, 'closed');
            }
        }
    }

    /**
     * 测试连接：只验证 TCP 能通 + 握手 + 认证能过，不开 shell 不占标签。
     *
     * draft 是表单当前内容（包括还没保存的密码），用完即丢，不落任何存储。
     * 主机密钥照常走 TOFU——测试连接也是一次真实握手，该记的记、该拦的拦。
     */
    async test(draft: ServerDraft): Promise<{ ok: boolean; detail?: string }> {
        const record: ServerRecord = {
            id: '', // 测试连接不涉及存储，id 用不上
            name: draft.name.trim(),
            host: normalizeHost(draft.host),
            port: parsePort(draft.port) ?? DEFAULT_PORT,
            username: draft.username.trim(),
            authMethod: parseAuthMethod(draft.authMethod),
            privateKeyPath: draft.privateKeyPath?.trim() || undefined,
            agentSocketPath: draft.agentSocketPath?.trim() || undefined
        };

        let config: ConnectConfig;
        try {
            config = {
                host: record.host,
                port: record.port,
                username: record.username,
                readyTimeout: TEST_TIMEOUT_MS,
                ...(await this.buildAuth(record, {
                    password: draft.password || undefined,
                    passphrase: draft.passphrase || undefined
                }))
            };
        } catch (error) {
            return { ok: false, detail: messageOf(error) };
        }

        return await new Promise((resolve) => {
            const client = new Client();
            let settled = false;
            const done = (result: { ok: boolean; detail?: string }): void => {
                if (settled) {
                    return;
                }
                settled = true;
                // ready 之后立刻收掉；error/close 路径连接反正已经没了
                try {
                    client.end();
                } catch {
                    // 握手都没走完时 end 可能抛错，没有可收拾的
                }
                resolve(result);
            };

            let hostKeyProblem: string | undefined;
            config.hostVerifier = (key: Buffer): boolean => {
                if (this.knownHosts.check(record.host, record.port, key) === 'mismatch') {
                    hostKeyProblem =
                        `${record.host}:${record.port} 的主机密钥和上次连接时不一样，` +
                        '可能存在中间人攻击。如果这台机器确实重装过系统或换过密钥，' +
                        '请删掉这条服务器记录后重新添加。';
                    return false;
                }
                return true;
            };

            client.on('ready', () => done({ ok: true }));
            client.on('error', (err) =>
                done({ ok: false, detail: hostKeyProblem ?? describeConnectError(err, record) })
            );
            // ready 前被远端直接关掉（少见）也会走到这，给一句兜底话
            client.on('close', () => done({ ok: false, detail: '连接被对方关闭' }));
            client.connect(config);
        });
    }

    private endClient(client: Client): void {
        try {
            client.end();
        } catch {
            // 连接还没建起来就 dispose 时 end() 可能抛错，此时也没什么可收拾的
        }
    }

    /** 收摊：先标记再删，重复调用无副作用（client 的 error/close 会各来一次）。 */
    private finish(sessionId: string, status: SessionStatus, detail?: string): void {
        const session = this.sessions.get(sessionId);
        if (!session || session.finished) {
            return;
        }
        session.finished = true;
        this.sessions.delete(sessionId);
        this.events.onStatus(sessionId, status, detail);
    }

    dispose(): void {
        for (const session of this.sessions.values()) {
            this.endClient(session.client);
            session.finished = true;
        }
        this.sessions.clear();
    }
}
