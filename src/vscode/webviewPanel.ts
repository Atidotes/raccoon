import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export type WebviewGame = 'tetris' | 'gomoku' | 'snake';
export type WebviewApp = WebviewGame | 'ssh';

/**
 * 需要给 style-src 放开 unsafe-inline 的面板。
 *
 * xterm.js 的 DOM 渲染器会在运行时往 DOM 里插 <style> 元素
 * （xterm.js 里的 _injectCss / _dimensionsStyleElement，用来写光标尺寸和主题），
 * 而不带 unsafe-inline 的 style-src 会拒绝一切 <style>，终端会因此排版全乱。
 *
 * 代价可控：面板只加载本地打包产物，default-src 'none' 仍然拦着所有对外请求，
 * 就算有样式注入也带不出数据，最坏是面板内部的视觉欺骗。
 */
const INLINE_STYLES_APPS: readonly WebviewApp[] = ['ssh'];

/**
 * 读取 dist/webviews/<app>/index.html（Vite 构建产物），把相对资源 URL 改写为
 * asWebviewUri，并在 <head> 最顶部注入 CSP。
 *
 * 三个要点：
 * 1. 生产构建没有内联脚本/样式，script 只需放开 cspSource；style 见上面
 *    INLINE_STYLES_APPS 的说明；
 * 2. meta CSP 只约束其后发起的资源加载，所以必须插在 <head> 之后立即（早于
 *    Vite 生成的 <link>/<script>），插在 </head> 前等于没有约束；
 * 3. 除了 ssh 面板，style-src 不含 unsafe-inline，意味着模板里连 style=""
 *    属性都不能用（会被拒）。
 */
export function webviewHtml(
    context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    app: WebviewApp
): string {
    const dir = path.join(context.extensionPath, 'dist', 'webviews', app);
    const htmlPath = path.join(dir, 'index.html');

    let html: string;
    try {
        html = fs.readFileSync(htmlPath, 'utf8');
    } catch {
        throw new Error(
            `找不到 webview 产物（${htmlPath}）。请先运行 npm run build:webviews 再启动扩展。`
        );
    }

    // 改写所有 src/href（Vite 产物：script src、link href、img src）
    html = html.replace(/\b(src|href)="([^"]+)"/g, (whole, attr: string, url: string) => {
        // http: data: mailto: #锚点 //cdn —— 原样保留
        if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(url)) {
            return whole;
        }
        const uri = panel.webview.asWebviewUri(vscode.Uri.file(path.resolve(dir, url)));
        return `${attr}="${uri.toString()}"`;
    });

    const styleSrc = INLINE_STYLES_APPS.includes(app)
        ? `${panel.webview.cspSource} 'unsafe-inline'`
        : panel.webview.cspSource;

    const csp = [
        "default-src 'none'",
        `script-src ${panel.webview.cspSource}`,
        `style-src ${styleSrc}`,
        `img-src ${panel.webview.cspSource} data:`
    ].join('; ');
    html = html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`);

    return html;
}
