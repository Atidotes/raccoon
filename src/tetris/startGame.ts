import * as vscode from 'vscode';
import { openGamePanel } from '../vscode/gamePanel';

const HIGH_SCORE_KEY = 'raccoon.tetris.highScore';
const PANEL_VIEW_TYPE = 'raccoon.tetris';
const PANEL_TITLE = '🎮 俄罗斯方块';

/**
 * 打开俄罗斯方块面板。面板生命周期、最高分读写、消息协议都由 gamePanel 工厂处理，
 * 这里只剩通知文案。
 */
export function startGame(context: vscode.ExtensionContext): void {
    openGamePanel(context, PANEL_VIEW_TYPE, 'tetris', {
        title: PANEL_TITLE,
        highScoreKey: HIGH_SCORE_KEY,
        onGameOver: (msg, isNewRecord) => {
            void vscode.window.showInformationMessage(
                isNewRecord
                    ? `🏆 新纪录！Retro Tetris 最高分：${msg.score}`
                    : `Retro Tetris — 得分：${msg.score}｜消行：${msg.lines ?? 0}`
            );
        }
    });
}
