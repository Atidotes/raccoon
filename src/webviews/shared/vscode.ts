/**
 * 与 VS Code 宿主的通信封装（tetris/snake 共用）。
 * acquireVsCodeApi 每次会话只能调一次，这里缓存成单例。
 * 消息协议见 src/shared/protocol.ts——webview 侧只 import 类型和消息名常量。
 */
import { MSG_HIGH_SCORE, MSG_READY } from '../../shared/protocol';
import type { HostToWebview, WebviewToHost } from '../../shared/protocol';

export interface VsCodeApi {
    postMessage(message: WebviewToHost): void;
}

/** VS Code webview 环境注入的全局函数（无头浏览器里不存在）。 */
declare function acquireVsCodeApi(): VsCodeApi;

let api: VsCodeApi | null | undefined;

/** 返回宿主 API；不在扩展宿主里跑（如无头浏览器截图）时返回 null。 */
export function useVsCodeApi(): VsCodeApi | null {
    if (api !== undefined) {
        return api;
    }
    api = null;
    try {
        if (typeof acquireVsCodeApi === 'function') {
            api = acquireVsCodeApi();
        }
    } catch {
        api = null;
    }
    return api;
}

/**
 * 挂载时发 {command:'ready'}，并监听宿主的 highScore 回填。
 * 行为与旧版 IIFE 一致：value || 0。
 */
export function useHighScoreSync(onUpdate: (value: number) => void): void {
    const vscode = useVsCodeApi();
    if (vscode) {
        vscode.postMessage({ command: MSG_READY });
    }

    window.addEventListener('message', (event) => {
        const msg = event.data as HostToWebview | undefined;
        if (msg && msg.command === MSG_HIGH_SCORE) {
            onUpdate(msg.value || 0);
        }
    });
}
