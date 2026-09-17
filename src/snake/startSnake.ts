import * as vscode from 'vscode';
import { openGamePanel } from '../vscode/gamePanel';

const HIGH_SCORE_KEY = 'raccoon.snake.highScore';
const PANEL_VIEW_TYPE = 'raccoon.snake';
const PANEL_TITLE = '🐍 贪吃蛇';

/**
 * 打开贪吃蛇面板。面板生命周期、最高分读写、消息协议都由 gamePanel 工厂处理，
 * 这里只剩通知文案。
 */
export function startSnake(context: vscode.ExtensionContext): void {
    openGamePanel(context, PANEL_VIEW_TYPE, 'snake', {
        title: PANEL_TITLE,
        highScoreKey: HIGH_SCORE_KEY,
        onGameOver: (msg, isNewRecord) => {
            // 吃满整盘：没有最高分之说，单独报一条
            if (msg.win) {
                void vscode.window.showInformationMessage(
                    `🐍 整盘吃满！得分：${msg.score}｜长度：${msg.length ?? 0}`
                );
                return;
            }

            void vscode.window.showInformationMessage(
                isNewRecord
                    ? `🏆 新纪录！贪吃蛇最高分：${msg.score}`
                    : `贪吃蛇 — 得分：${msg.score}｜长度：${msg.length ?? 0}`
            );
        }
    });
}
