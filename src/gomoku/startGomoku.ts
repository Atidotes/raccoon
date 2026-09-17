import * as vscode from 'vscode';
import { openGamePanel } from '../vscode/gamePanel';

const PANEL_VIEW_TYPE = 'raccoon.gomoku';
const PANEL_TITLE = '⚫⚪ 五子棋';

/**
 * 打开五子棋面板。游戏状态全在网页里，没有消息往来，也没有最高分。
 */
export function startGomoku(context: vscode.ExtensionContext): void {
    openGamePanel(context, PANEL_VIEW_TYPE, 'gomoku', {
        title: PANEL_TITLE
    });
}
