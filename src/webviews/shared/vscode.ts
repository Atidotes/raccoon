/**
 * 宿主通信封装（四个 webview 共用）。
 *
 * 同一份前端产物要跑在两种宿主里：
 *   - VS Code：注入 acquireVsCodeApi()，宿主消息是 window 上的 DOM message 事件
 *   - Visual Studio：WebView2 桥，消息挂在 window.chrome.webview 对象上
 * 这个文件把两者的差异吃下来，上层只认 WebviewToHost / HostToWebview 两个协议类型。
 *
 * acquireVsCodeApi 每次会话只能调一次，这里缓存成单例。
 * 消息协议见 src/shared/protocol.ts——webview 侧只 import 类型和消息名常量。
 */
import {
    MSG_HIGH_SCORE,
    MSG_READY,
    MSG_THEME,
    THEME_DARK,
    THEME_LIGHT
} from '../../shared/protocol';
import type { HostToWebview, ThemeKind, WebviewToHost } from '../../shared/protocol';

export interface VsCodeApi {
    postMessage(message: WebviewToHost): void;
}

/** VS Code webview 环境注入的全局函数（无头浏览器里不存在）。 */
declare function acquireVsCodeApi(): VsCodeApi;

/** WebView2 注入的桥对象。postMessage 收任意可序列化对象，不需要手动 JSON.stringify。 */
interface WebView2Bridge extends MessageTarget {
    postMessage(message: unknown): void;
}

/**
 * 能挂 message 监听的目标。用结构化类型而不是 EventTarget：桥对象只有这两个方法，
 * 没有 dispatchEvent，套 EventTarget 反而对不上。
 */
interface MessageTarget {
    addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
    removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

/**
 * 取 WebView2 桥；不在 WebView2 里跑时返回 null。
 *
 * 判断必须落到 chrome.webview 上——VS Code 的 Electron 里 window.chrome 本身就存在
 * （只是没有 webview 属性），只判断 chrome 会把 VS Code 误判成 WebView2。
 */
function webview2Bridge(): WebView2Bridge | null {
    const chrome = (window as unknown as { chrome?: { webview?: WebView2Bridge } }).chrome;
    return chrome?.webview ?? null;
}

const bridge = webview2Bridge();

let api: VsCodeApi | null | undefined;

/**
 * 返回宿主 API；不在任何宿主里跑（如无头浏览器截图）时返回 null。
 * WebView2 下同样返回一个可用的对象，postMessage 转投 chrome.webview。
 */
export function useVsCodeApi(): VsCodeApi | null {
    if (api !== undefined) {
        return api;
    }

    if (bridge) {
        // 宿主不校验返回值，这里只需要它可序列化即可
        api = { postMessage: (message) => bridge.postMessage(message) };
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
 * 监听宿主推来的消息，返回解绑函数。
 *
 * 两个宿主的事件目标不同：WebView2 打在 chrome.webview 上，VS Code 打在 window 上。
 * 事件载荷是一致的——C# 侧恒用 PostWebMessageAsJson，两边的 event.data 都是已解析对象。
 */
export function onHostMessage(handler: (message: HostToWebview) => void): () => void {
    const target: MessageTarget = bridge ?? window;
    const listener = (event: { data: unknown }): void => {
        const message = event.data as HostToWebview | undefined;
        if (message) {
            handler(message);
        }
    };
    target.addEventListener('message', listener);
    return () => target.removeEventListener('message', listener);
}

/**
 * 把宿主报来的主题落到 <html> 上：theme.css 靠这个属性切换调色板。
 * VS Code 注入的 --vscode-* 变量永远赢过 CSS 里的兜底值（变量就近生效），
 * 所以这条只在 WebView2 里实际改变画面。
 */
export function applyTheme(kind: ThemeKind): void {
    const theme = kind === THEME_LIGHT ? 'light' : THEME_DARK;
    document.documentElement.dataset.raccoonTheme = theme;
}

/**
 * 挂载时发 {command:'ready'}，并监听宿主的 highScore 回填与主题下发。
 * 行为与旧版 IIFE 一致：value || 0。
 */
export function useHighScoreSync(onUpdate: (value: number) => void): void {
    const vscode = useVsCodeApi();
    if (vscode) {
        vscode.postMessage({ command: MSG_READY });
    }

    onHostMessage((msg) => {
        if (msg.command === MSG_HIGH_SCORE) {
            onUpdate(msg.value || 0);
        } else if (msg.command === MSG_THEME) {
            applyTheme(msg.theme);
        }
    });
}
