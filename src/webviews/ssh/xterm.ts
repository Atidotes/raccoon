/**
 * xterm 实例的创建封装。
 *
 * 只做「把 DOM 和 xterm 接起来」这件事：输入往宿主的 SSH 通道送，
 * 通道回来的数据由调用方通过 write() 灌进来。
 */
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

export interface TerminalHooks {
    /** 用户敲了键盘 */
    onData(data: string): void;
    /** 终端行列数变了（首帧、拖窗口、切标签都会触发） */
    onResize(cols: number, rows: number): void;
}

export interface TerminalHandle {
    /** 把远端输出写进终端 */
    write(data: string): void;
    /** 重新计算行列数。容器隐藏时是空操作，见 fit 里的说明 */
    fit(): void;
    focus(): void;
    dispose(): void;
}

/** VS Code 深色主题的 ANSI 配色，取不到主题变量时用它兜底。 */
const ANSI_FALLBACK = {
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#e5e5e5'
};

function readVar(name: string, fallback: string): string {
    const value = getComputedStyle(document.body).getPropertyValue(name).trim();
    return value || fallback;
}

/**
 * 从 VS Code 注入的 CSS 变量里取配色和字体。
 *
 * 字体必须取出真实值，不能直接把 `var(--vscode-editor-font-family)` 交给 xterm：
 * 它要靠 canvas 量字符宽度来排版，拿到未解析的 var() 就量不出东西，
 * 终端会退化成等宽默认字体甚至错位。
 */
function buildTheme() {
    const foreground = readVar('--vscode-terminal-foreground', readVar('--vscode-editor-foreground', '#cccccc'));
    return {
        background: readVar('--vscode-terminal-background', readVar('--vscode-editor-background', '#1e1e1e')),
        foreground,
        cursor: readVar('--vscode-terminalCursor-foreground', foreground),
        cursorAccent: readVar('--vscode-terminal-background', '#1e1e1e'),
        selectionBackground: readVar('--vscode-terminal-selectionBackground', '#264f78'),
        ...ANSI_FALLBACK
    };
}

export function createTerminal(container: HTMLElement, hooks: TerminalHooks): TerminalHandle {
    const terminal = new Terminal({
        cursorBlink: true,
        fontFamily: readVar('--vscode-editor-font-family', 'monospace'),
        fontSize: parseFloat(readVar('--vscode-editor-font-size', '13px')) || 13,
        scrollback: 5000,
        theme: buildTheme()
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);

    const dataSub = terminal.onData((value) => hooks.onData(value));
    const resizeSub = terminal.onResize(({ cols, rows }) => hooks.onResize(cols, rows));

    function fit(): void {
        // 标签切走时容器是 display:none，此时量出来的行列数是 0，
        // 发到远端就等于把窗口缩成 0 列，切回来还得再改一次，干脆跳过
        if (container.clientWidth === 0 || container.clientHeight === 0) {
            return;
        }
        try {
            fitAddon.fit();
        } catch {
            // 布局还没稳定时 fit 可能抛错，忽略；下一帧或下次 resize 会再算
        }
    }

    // open() 之后布局未必已完成，等一帧再量。
    // 这次 fit 产出的尺寸会通过 onResize 发回宿主，用来修正连接时那次估计值。
    requestAnimationFrame(fit);

    const observer = new ResizeObserver(fit);
    observer.observe(container);

    return {
        write: (value) => terminal.write(value),
        fit,
        focus: () => terminal.focus(),
        dispose: () => {
            observer.disconnect();
            dataSub.dispose();
            resizeSub.dispose();
            terminal.dispose();
        }
    };
}
