/**
 * webview ↔ 宿主的消息协议，两端共用。
 *
 * 注意：webview 与宿主跑在两个进程里，不能共享任何运行时代码——跨边界的
 * import 只能是 import type（编译期擦除）或纯常量（各自打包一份）。所以
 * 这个文件里只有类型和消息名常量，不要往里加函数。
 */

export const MSG_READY = 'ready';
export const MSG_HIGH_SCORE = 'highScore';
export const MSG_GAME_OVER = 'gameOver';

export interface ReadyMessage {
    command: typeof MSG_READY;
}

export interface HighScoreMessage {
    command: typeof MSG_HIGH_SCORE;
    value: number;
}

export interface GameOverMessage {
    command: typeof MSG_GAME_OVER;
    score: number;
    /** 俄罗斯方块：消行数（贪吃蛇不发这个字段） */
    lines?: number;
    /** 贪吃蛇：长度（俄罗斯方块不发这个字段） */
    length?: number;
    /** 贪吃蛇：等级 */
    level?: number;
    /** 贪吃蛇：吃满整盘的通关 */
    win?: boolean;
}

/** webview → 宿主 */
export type WebviewToHost = ReadyMessage | GameOverMessage;

/** 宿主 → webview */
export type HostToWebview = HighScoreMessage;
