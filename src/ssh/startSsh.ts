import * as vscode from 'vscode';
import { openSshPanel } from './terminalPanel';

/**
 * 打开 SSH 连接面板。服务器列表和终端都在这个面板里，
 * 侧边栏只负责当一个入口。
 */
export function startSsh(context: vscode.ExtensionContext): void {
    openSshPanel(context);
}
