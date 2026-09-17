import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export type WebviewGame = 'tetris' | 'gomoku' | 'snake';

/**
 * 读取 dist/webviews/<game>/index.html（Vite 构建产物），把相对资源 URL 改写为
 * asWebviewUri，并在 <head> 最顶部注入不含 unsafe-inline 的 CSP。
 *
 * 三个要点：
 * 1. 生产构建没有内联脚本/样式，script/style 只需放开 cspSource；
 * 2. meta CSP 只约束其后发起的资源加载，所以必须插在 <head> 之后立即（早于
 *    Vite 生成的 <link>/<script>），插在 </head> 前等于没有约束；
 * 3. style-src 不含 unsafe-inline 意味着模板里连 style="" 属性都不能用（会被拒）。
 */
export function webviewHtml(
    context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    game: WebviewGame
): string {
    const dir = path.join(context.extensionPath, 'dist', 'webviews', game);
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

    const csp = [
        "default-src 'none'",
        `script-src ${panel.webview.cspSource}`,
        `style-src ${panel.webview.cspSource}`,
        `img-src ${panel.webview.cspSource} data:`
    ].join('; ');
    html = html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`);

    return html;
}
