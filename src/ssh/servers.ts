import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { FieldErrors, ServerDraft, ServerListItem, ServerRecord } from './types';
import { normalizeHost, parseAuthMethod, parsePort, validateDraft } from './validate';

const SERVERS_KEY = 'raccoon.ssh.servers';
const PASSWORD_KEY = (id: string) => `raccoon.ssh.password.${id}`;
const PASSPHRASE_KEY = (id: string) => `raccoon.ssh.passphrase.${id}`;

/**
 * 服务器列表的读写。
 *
 * 存 globalState 而不是工作区设置，有两个原因：一是这些机器跨项目都用得上；
 * 二是工作区里的 .vscode/settings.json 通常会跟进 git，一份带主机名和用户名的
 * 服务器清单跟着仓库推到远端，等于白送攻击者一张内网地图。
 *
 * 密码和私钥 passphrase 再进一步，只进 SecretStorage（macOS 钥匙串 /
 * Windows 凭据管理器 / Linux libsecret），既不落工作区，也不落 globalState
 * 那个明文 JSON 文件。
 */
export class ServerStore {
    constructor(
        private readonly state: vscode.Memento,
        private readonly secrets: vscode.SecretStorage
    ) { }

    private readAll(): ServerRecord[] {
        // 外部存储可能被手改过，取出来先过一遍形状检查，别让坏数据一路炸到连接时才报错
        const raw = this.state.get<unknown>(SERVERS_KEY);
        if (!Array.isArray(raw)) {
            return [];
        }
        return raw.map(readRecord).filter((record): record is ServerRecord => record !== undefined);
    }

    list(): ServerRecord[] {
        return this.readAll();
    }

    get(id: string): ServerRecord | undefined {
        return this.readAll().find((record) => record.id === id);
    }

    /** 组装发给 webview 的列表：只多带两个「有没有存过」的布尔标记。 */
    async listForWebview(): Promise<ServerListItem[]> {
        const records = this.readAll();
        return Promise.all(
            records.map(async (record) => ({
                ...record,
                hasStoredPassword: (await this.secrets.get(PASSWORD_KEY(record.id))) !== undefined,
                hasStoredPassphrase:
                    (await this.secrets.get(PASSPHRASE_KEY(record.id))) !== undefined
            }))
        );
    }

    /**
     * 新建或更新一台服务器：draft.id 认得出就是更新，否则新建。
     * 校验不通过返回 errors，调用方原样回给 webview 填到表单上。
     */
    async save(draft: ServerDraft): Promise<{ errors: FieldErrors } | { record: ServerRecord }> {
        const errors = validateDraft(draft);
        if (Object.keys(errors).length > 0) {
            return { errors };
        }

        const record: ServerRecord = {
            // 认不出 id 就当作新建，免得 webview 拿着过期 id 提交时静默什么都不发生
            id: (draft.id ? this.get(draft.id)?.id : undefined) ?? randomUUID(),
            name: draft.name.trim(),
            host: normalizeHost(draft.host),
            port: parsePort(draft.port) ?? 22,
            username: draft.username.trim(),
            authMethod: parseAuthMethod(draft.authMethod),
            privateKeyPath: draft.privateKeyPath?.trim() || undefined,
            agentSocketPath: draft.agentSocketPath?.trim() || undefined
        };

        // 新记录排前面，刚加的机器一眼就能看到
        await this.state.update(SERVERS_KEY, [
            record,
            ...this.readAll().filter((item) => item.id !== record.id)
        ]);

        await this.syncSecret(PASSWORD_KEY(record.id), record.authMethod === 'password', draft.password);
        await this.syncSecret(
            PASSPHRASE_KEY(record.id),
            record.authMethod === 'privateKey',
            draft.passphrase
        );

        return { record };
    }

    /**
     * 密钥的三态处理：认证方式用不上它 → 删掉；留空 → 保持原样；填了 → 覆盖。
     * 不 trim：密码首尾的空格可能就是密码的一部分。
     */
    private async syncSecret(key: string, relevant: boolean, pending: string | undefined): Promise<void> {
        if (!relevant) {
            await this.secrets.delete(key);
            return;
        }
        if (pending) {
            await this.secrets.store(key, pending);
        }
    }

    async remove(id: string): Promise<void> {
        await this.state.update(
            SERVERS_KEY,
            this.readAll().filter((record) => record.id !== id)
        );
        // 记录没了，密钥也必须跟着走，否则钥匙串里会攒下一堆孤儿密码
        await this.secrets.delete(PASSWORD_KEY(id));
        await this.secrets.delete(PASSPHRASE_KEY(id));
    }

    async password(id: string): Promise<string | undefined> {
        return this.secrets.get(PASSWORD_KEY(id));
    }

    async passphrase(id: string): Promise<string | undefined> {
        return this.secrets.get(PASSPHRASE_KEY(id));
    }
}

/** 把存储里的一项还原成 ServerRecord；形状不对就丢掉（返回 undefined）。 */
function readRecord(raw: unknown): ServerRecord | undefined {
    if (typeof raw !== 'object' || raw === null) {
        return undefined;
    }
    const item = raw as Record<string, unknown>;
    const port = parsePort(item.port);
    if (
        typeof item.id !== 'string' ||
        typeof item.name !== 'string' ||
        typeof item.host !== 'string' ||
        typeof item.username !== 'string' ||
        port === undefined
    ) {
        return undefined;
    }

    return {
        id: item.id,
        name: item.name,
        host: item.host,
        port,
        username: item.username,
        authMethod: parseAuthMethod(item.authMethod),
        privateKeyPath: typeof item.privateKeyPath === 'string' ? item.privateKeyPath : undefined,
        agentSocketPath: typeof item.agentSocketPath === 'string' ? item.agentSocketPath : undefined
    };
}
