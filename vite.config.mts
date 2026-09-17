import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * 三个游戏 webview 的多入口构建（只 build，不用 dev server）。
 *
 * root 指到 src/webviews：Vite 8 按输入文件相对 root 的解析路径生成
 * HTML 输出位置，这样才能落在 dist/webviews/<game>/index.html。
 */
export default defineConfig({
    root: 'src/webviews',
    plugins: [vue()],
    base: './',
    publicDir: false,
    build: {
        // 相对 root 解析 → <项目根>/dist/webviews
        outDir: '../../dist/webviews',
        // outDir 在 root 之外，必须显式开
        emptyOutDir: true,
        // engines ^1.75.0 = Electron 19 = Chromium 102，Vite 8 默认 chrome111 必须覆盖
        target: 'chrome102',
        // polyfill 会向 HTML 注入内联脚本，CSP 下不允许也多余
        modulePreload: { polyfill: false },
        rolldownOptions: {
            input: {
                tetris: 'tetris/index.html',
                gomoku: 'gomoku/index.html',
                snake: 'snake/index.html'
            }
        }
    }
});
