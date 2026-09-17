import * as vscode from 'vscode';
import {
    GameOverMessage,
    MSG_GAME_OVER,
    MSG_HIGH_SCORE,
    MSG_READY,
    WebviewToHost
} from '../shared/protocol';
import { WebviewGame, webviewHtml } from './webviewPanel';

/**
 * 游戏面板工厂：三个游戏（俄罗斯方块 / 五子棋 / 贪吃蛇）共用的
 * 面板生命周期 + 最高分 + 消息协议处理。各游戏自己保留的只有通知文案。
 *
 * 单例按 viewType 记忆：面板还开着时再点命令，只是把它显示出来，
 * 不会并排开出第二局。
 */
const openPanels = new Map<string, vscode.WebviewPanel>();

export interface GamePanelOptions {
    /** 面板标题 */
    title: string;
    /** 最高分 globalState 键。传了才处理破纪录更新与回填（五子棋不传） */
    highScoreKey?: string;
    /**
     * 游戏结束回调（弹通知等）。isNewRecord 表示这次打破了纪录；
     * 最高分的更新与回填由工厂负责，回调里不用再碰 globalState。
     */
    onGameOver?: (msg: GameOverMessage, isNewRecord: boolean) => void;
}

export function openGamePanel(
    context: vscode.ExtensionContext,
    viewType: string,
    game: WebviewGame,
    options: GamePanelOptions
): vscode.WebviewPanel {
    const existing = openPanels.get(viewType);
    if (existing) {
        existing.reveal(vscode.ViewColumn.Beside);
        return existing;
    }

    const panel = vscode.window.createWebviewPanel(
        viewType,
        options.title,
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            // 切到别的编辑器再切回来时保留游戏进度，否则重开一局
            retainContextWhenHidden: true
        }
    );

    openPanels.set(viewType, panel);
    panel.onDidDispose(() => {
        openPanels.delete(viewType);
    }, undefined, context.subscriptions);

    panel.webview.html = webviewHtml(context, panel, game);

    panel.webview.onDidReceiveMessage(
        (msg: WebviewToHost | undefined) => {
            if (!msg) {
                return;
            }

            switch (msg.command) {
                case MSG_READY:
                    panel.webview.postMessage({
                        command: MSG_HIGH_SCORE,
                        value: options.highScoreKey
                            ? context.globalState.get<number>(options.highScoreKey, 0)
                            : 0
                    });
                    break;

                case MSG_GAME_OVER: {
                    let isNewRecord = false;
                    if (options.highScoreKey && !msg.win) {
                        const best = context.globalState.get<number>(options.highScoreKey, 0);
                        if (msg.score > best) {
                            isNewRecord = true;
                            void context.globalState.update(options.highScoreKey, msg.score);
                            panel.webview.postMessage({ command: MSG_HIGH_SCORE, value: msg.score });
                        }
                    }
                    options.onGameOver?.(msg, isNewRecord);
                    break;
                }
            }
        },
        undefined,
        context.subscriptions
    );

    return panel;
}
