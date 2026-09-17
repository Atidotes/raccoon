import * as vscode from 'vscode';
import {
    HostToWebview,
    MSG_SSH_CLOSE,
    MSG_SSH_CONNECT,
    MSG_SSH_DATA,
    MSG_SSH_DELETE,
    MSG_SSH_FORM_ERROR,
    MSG_SSH_INPUT,
    MSG_SSH_READY,
    MSG_SSH_RESIZE,
    MSG_SSH_SAVE,
    MSG_SSH_SERVERS,
    MSG_SSH_STATUS,
    MSG_SSH_TEST,
    MSG_SSH_TEST_RESULT,
    WebviewToHost
} from '../shared/protocol';
import { webviewHtml } from '../vscode/webviewPanel';
import { KnownHosts } from './knownHosts';
import { SshSessionManager } from './sessionManager';
import { ServerStore } from './servers';
import { validateDraft } from './validate';

const VIEW_TYPE = 'raccoon.ssh';
const PANEL_TITLE = '🖥 SSH 连接';

/** 面板单例：还开着的时候再点命令只是把它显示出来，不会开出第二个。 */
let current: vscode.WebviewPanel | undefined;

export function openSshPanel(context: vscode.ExtensionContext): void {
    if (current) {
        current.reveal(vscode.ViewColumn.One);
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        VIEW_TYPE,
        PANEL_TITLE,
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            // 切到别的编辑器再切回来时把终端画面和标签留着，
            // 否则每次切走都等于断线重连
            retainContextWhenHidden: true
        }
    );
    current = panel;

    const post = (message: HostToWebview): void => {
        void panel.webview.postMessage(message);
    };

    const store = new ServerStore(context.globalState, context.secrets);
    const sessions = new SshSessionManager(store, new KnownHosts(context.globalState), {
        onData: (sessionId, data) => post({ command: MSG_SSH_DATA, sessionId, data }),
        onStatus: (sessionId, status, detail) =>
            post({ command: MSG_SSH_STATUS, sessionId, status, detail })
    });

    /** 把最新的服务器列表推给 webview。增删改之后都要走一次，让两边保持一致。 */
    const pushServers = async (): Promise<void> => {
        post({ command: MSG_SSH_SERVERS, servers: await store.listForWebview() });
    };

    panel.webview.html = webviewHtml(context, panel, 'ssh');

    panel.webview.onDidReceiveMessage(
        async (msg: WebviewToHost | undefined) => {
            if (!msg) {
                return;
            }

            switch (msg.command) {
                case MSG_SSH_READY:
                    await pushServers();
                    break;

                case MSG_SSH_SAVE: {
                    const result = await store.save(msg.draft);
                    if ('errors' in result) {
                        post({ command: MSG_SSH_FORM_ERROR, errors: result.errors });
                        break;
                    }
                    await pushServers();
                    break;
                }

                case MSG_SSH_DELETE: {
                    const target = store.get(msg.id);
                    if (!target) {
                        break;
                    }
                    // 删记录会连钥匙串里的密码一起清掉，这一步不可逆，问一句
                    const choice = await vscode.window.showWarningMessage(
                        `确定删除服务器「${target.name}」吗？保存的密码也会一并删除。`,
                        { modal: true },
                        '删除'
                    );
                    if (choice !== '删除') {
                        break;
                    }
                    // 先断掉这台机器的会话再删记录。webview 收到新列表后，
                    // 会把列表里已经不存在的服务器的标签收掉
                    sessions.closeByServer(msg.id);
                    await store.remove(msg.id);
                    await pushServers();
                    break;
                }

                case MSG_SSH_CONNECT: {
                    const server = store.get(msg.serverId);
                    if (!server) {
                        // 列表在别的窗口被改过时可能出现这种竞态，给一句能看懂的话
                        post({
                            command: MSG_SSH_STATUS,
                            sessionId: msg.sessionId,
                            status: 'error',
                            detail: '找不到这台服务器，它可能已经被删掉了。'
                        });
                        break;
                    }
                    // open 内部自己接住所有失败并通过 onStatus 上报，这里不用 await
                    void sessions.open(msg.sessionId, server, msg.cols, msg.rows);
                    break;
                }

                case MSG_SSH_CLOSE:
                    sessions.close(msg.sessionId);
                    break;

                case MSG_SSH_INPUT:
                    sessions.input(msg.sessionId, msg.data);
                    break;

                case MSG_SSH_RESIZE:
                    sessions.resize(msg.sessionId, msg.cols, msg.rows);
                    break;

                case MSG_SSH_TEST: {
                    // 表单不合法就逐字段回填，别发起一次注定要失败的连接
                    const errors = validateDraft(msg.draft);
                    if (Object.keys(errors).length > 0) {
                        post({ command: MSG_SSH_FORM_ERROR, errors });
                        break;
                    }
                    const result = await sessions.test(msg.draft);
                    post({ command: MSG_SSH_TEST_RESULT, ok: result.ok, detail: result.detail });
                    break;
                }
            }
        },
        undefined,
        context.subscriptions
    );

    panel.onDidDispose(
        () => {
            // 面板没了，背后的 SSH 连接也没理由继续挂着
            sessions.dispose();
            current = undefined;
        },
        undefined,
        context.subscriptions
    );
}
