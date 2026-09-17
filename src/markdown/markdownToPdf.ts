import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { promisify } from 'util';
import { Marked } from 'marked';
import { gfmHeadingId } from 'marked-gfm-heading-id';

const execFileAsync = promisify(execFile);

/**
 * 用独立实例而非全局 marked.use()，避免影响插件里其他可能用到 marked 的地方。
 *
 * 挂 gfmHeadingId 是为了给标题生成 GitHub 风格的 id —— marked 默认不加 id，
 * 中文文档里常见的 `[章节](#锚点)` 会变成死链。
 */
const mdRenderer = new Marked({ gfm: true }, gfmHeadingId());

// ---------------------------------------------------------------------------
// 样式（GitHub 风格，A4 纸）
// ---------------------------------------------------------------------------
const CSS = `
@page {
  size: A4;
  margin: 16mm 15mm 18mm 15mm;
  @bottom-center {
    content: counter(page) " / " counter(pages);
    font-size: 8pt;
    color: #8b949e;
  }
}
* { box-sizing: border-box; }
body {
  font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
               "Noto Sans CJK SC", "WenQuanYi Micro Hei", sans-serif;
  font-size: 10pt;
  line-height: 1.6;
  color: #1f2328;
  margin: 0;
  /* 不加这行 Chrome 默认不打印背景色，代码块和表头会变成白底 */
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
h1 { font-size: 20pt; margin: 0 0 .8em; padding-bottom: .3em;
     border-bottom: 2px solid #d0d7de; }
h2 { font-size: 14pt; margin: 1.5em 0 .6em; padding-bottom: .25em;
     border-bottom: 1px solid #eaecef; page-break-after: avoid; }
h3 { font-size: 11.5pt; margin: 1.2em 0 .4em; page-break-after: avoid; }
h4 { font-size: 10.5pt; margin: 1em 0 .3em; page-break-after: avoid; }
p { margin: .5em 0; }
table { border-collapse: collapse; width: 100%; margin: .8em 0; font-size: 9pt; }
th, td { border: 1px solid #d0d7de; padding: 4px 7px; vertical-align: top; }
th { background: #f6f8fa; font-weight: 600; }
tr { page-break-inside: avoid; }
code { font-family: "SF Mono", Menlo, Consolas, "Courier New", monospace;
       font-size: 8.5pt; background: #f2f4f7; padding: 1px 4px; border-radius: 3px; }
pre { background: #f6f8fa; border: 1px solid #eaecef; border-radius: 6px;
      padding: 10px 12px; overflow-x: auto; page-break-inside: avoid; }
pre code { background: none; padding: 0; font-size: 8.5pt; line-height: 1.45; }
blockquote { border-left: 4px solid #d0d7de; margin: .8em 0; padding: .1em 1em;
             color: #57606a; background: #f6f8fa; }
blockquote p { margin: .4em 0; }
a { color: #0969da; text-decoration: none; }
hr { border: none; border-top: 1px solid #eaecef; margin: 1.5em 0; }
ul, ol { padding-left: 1.6em; }
li { margin: .15em 0; }
img { max-width: 100%; }
`;

// ---------------------------------------------------------------------------
// 相对链接改写
// ---------------------------------------------------------------------------
const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * 把指向仓库文件的相对链接改写为 file:// 绝对地址，这样 PDF 里点击能直接打开本地文件。
 * 解析不了的一律原样返回，绝不破坏原文。
 */
export function rewriteLink(label: string, rawTarget: string, baseDir: string): string {
    const target = rawTarget.trim();
    if (/^(https?:|mailto:|#|\/)/.test(target)) {
        return `[${label}](${rawTarget})`;
    }

    const hashAt = target.indexOf('#');
    const pathPart = hashAt === -1 ? target : target.slice(0, hashAt);
    const anchor = hashAt === -1 ? '' : target.slice(hashAt);

    let decoded: string;
    try {
        decoded = decodeURIComponent(pathPart);
    } catch {
        return `[${label}](${rawTarget})`;
    }

    if (!decoded || decoded.startsWith('.')) {
        return `[${label}](${rawTarget})`;
    }

    const filePath = path.resolve(baseDir, decoded);
    if (!fs.existsSync(filePath)) {
        return `[${label}](${rawTarget})`;
    }

    return `[${label}](${pathToFileURL(filePath).href}${anchor})`;
}

/** 逐行改写链接，代码围栏内的内容跳过。 */
export function rewriteLinks(mdText: string, baseDir: string): string {
    let inFence = false;

    return mdText
        .split('\n')
        .map((line) => {
            if (line.trimStart().startsWith('```')) {
                inFence = !inFence;
                return line;
            }
            if (inFence) {
                return line;
            }
            return line.replace(LINK_RE, (_m, label: string, target: string) =>
                rewriteLink(label, target, baseDir)
            );
        })
        .join('\n');
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Markdown → 完整 HTML 文档。 */
export function markdownToHtml(mdText: string, title: string, baseDir: string): string {
    const body = mdRenderer.parse(rewriteLinks(mdText, baseDir), { async: false });

    return [
        '<!DOCTYPE html>',
        '<html lang="zh-CN">',
        '<head>',
        '<meta charset="utf-8">',
        `<title>${escapeHtml(title)}</title>`,
        `<style>${CSS}</style>`,
        '</head>',
        '<body>',
        body,
        '</body>',
        '</html>'
    ].join('\n');
}

// ---------------------------------------------------------------------------
// Chrome 探测
// ---------------------------------------------------------------------------
const CHROME_CANDIDATES = [
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];

const CHROME_ON_PATH = [
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    'chrome',
    'msedge'
];

function isExecutableFile(candidate: string): boolean {
    try {
        return fs.statSync(candidate).isFile();
    } catch {
        return false;
    }
}

function which(command: string): string | undefined {
    const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
    const exts = process.platform === 'win32'
        ? (process.env.PATHEXT ?? '.EXE').split(path.delimiter)
        : [''];

    for (const dir of dirs) {
        for (const ext of exts) {
            const full = path.join(dir, command + ext);
            if (isExecutableFile(full)) {
                return full;
            }
        }
    }
    return undefined;
}

/**
 * 依次探测：插件设置 → CHROME_BIN 环境变量 → 常见安装路径 → PATH。
 * 返回 undefined 表示没找到。
 *
 * candidates / onPath 可注入（默认即上述硬编码列表），测试时换成临时目录里的
 * fixture 文件，避免本机真实安装的 Chrome 短路探测。
 */
export function findChrome(
    configuredPath?: string,
    options?: { candidates?: string[]; onPath?: string[] }
): string | undefined {
    const configured = configuredPath?.trim();
    if (configured) {
        if (!isExecutableFile(configured)) {
            throw new Error(`设置里的 Chrome 路径不存在：${configured}`);
        }
        return configured;
    }

    const envBin = process.env.CHROME_BIN?.trim();
    if (envBin && isExecutableFile(envBin)) {
        return envBin;
    }

    for (const candidate of options?.candidates ?? CHROME_CANDIDATES) {
        if (isExecutableFile(candidate)) {
            return candidate;
        }
    }

    for (const command of options?.onPath ?? CHROME_ON_PATH) {
        const found = which(command);
        if (found) {
            return found;
        }
    }

    return undefined;
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------
export interface ConvertOptions {
    markdownPath: string;
    outputPath: string;
    /** 设置里指定的 Chrome 路径，可选 */
    chromePath?: string;
}

/**
 * 把 Markdown 文件转成 PDF。
 *
 * 中间产物 HTML 写在独立临时目录里，渲染结束（无论成败）都会删除。
 *
 * 注意：不要给 Chrome 传 --user-data-dir 指向全新目录。实测（Chrome 152 / macOS）
 * 它会先把 PDF 写出来，然后卡在退出阶段不返回。不带这个参数时 1 秒内正常结束。
 */
export async function convertMarkdownToPdf(options: ConvertOptions): Promise<void> {
    const { markdownPath, outputPath, chromePath } = options;

    const chrome = findChrome(chromePath);
    if (!chrome) {
        throw new Error(
            '未找到 Chrome / Chromium / Edge。请安装其一，或在设置里指定 "raccoon.pdf.chromePath"。'
        );
    }

    const mdText = fs.readFileSync(markdownPath, 'utf8');
    const html = markdownToHtml(
        mdText,
        path.basename(markdownPath, path.extname(markdownPath)),
        path.dirname(markdownPath)
    );

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-md2pdf-'));
    const htmlPath = path.join(workDir, 'index.html');

    try {
        fs.writeFileSync(htmlPath, html, 'utf8');

        await execFileAsync(
            chrome,
            [
                '--headless',
                '--disable-gpu',
                '--disable-extensions',
                '--no-pdf-header-footer',
                `--print-to-pdf=${outputPath}`,
                pathToFileURL(htmlPath).href
            ],
            { maxBuffer: 32 * 1024 * 1024 }
        );

        if (!fs.existsSync(outputPath)) {
            throw new Error('Chrome 已退出，但没有生成 PDF。');
        }
    } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
}
