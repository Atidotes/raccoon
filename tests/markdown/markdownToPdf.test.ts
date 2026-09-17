/**
 * Markdown → PDF：纯函数测试（rewriteLinks / markdownToHtml / findChrome）。
 * convertMarkdownToPdf 会真实拉起 Chrome，不测。
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findChrome, markdownToHtml, rewriteLink, rewriteLinks } from '../../src/markdown/markdownToPdf';

const envBackup: Record<string, string | undefined> = {};

afterEach(() => {
    for (const [k, v] of Object.entries(envBackup)) {
        if (v === undefined) {
            delete process.env[k];
        } else {
            process.env[k] = v;
        }
    }
});

function backupEnv(...keys: string[]): void {
    for (const k of keys) {
        envBackup[k] = process.env[k];
    }
}

/** 建一个临时目录，往里放指定文件，返回目录路径。 */
function makeFixture(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raccoon-md-test-'));
    for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, name), content);
    }
    return dir;
}

describe('rewriteLink', () => {
    const dir = makeFixture({ 'target.md': '# 目标', '中文 文件.md': 'x' });
    const fileUrl = (p: string) => 'file://' + p;

    it('https/mailto/#锚点/绝对路径 原样返回', () => {
        expect(rewriteLink('x', 'https://example.com/a', dir)).toBe('[x](https://example.com/a)');
        expect(rewriteLink('x', 'mailto:a@b.c', dir)).toBe('[x](mailto:a@b.c)');
        expect(rewriteLink('x', '#章节', dir)).toBe('[x](#章节)');
        expect(rewriteLink('x', '/etc/passwd', dir)).toBe('[x](/etc/passwd)');
    });

    it('存在的相对路径 → file:// 绝对地址，锚点保留', () => {
        expect(rewriteLink('x', 'target.md', dir)).toBe(`[x](${fileUrl(path.join(dir, 'target.md'))})`);
        expect(rewriteLink('x', 'target.md#sec', dir)).toBe(
            `[x](${fileUrl(path.join(dir, 'target.md'))}#sec)`
        );
    });

    it('百分号编码解码后再解析（pathToFileURL 会再编码非 ASCII）', () => {
        const { pathToFileURL } = require('url') as typeof import('url');
        expect(rewriteLink('x', '%E4%B8%AD%E6%96%87%20%E6%96%87%E4%BB%B6.md', dir)).toBe(
            `[x](${pathToFileURL(path.join(dir, '中文 文件.md')).href})`
        );
    });

    it('不存在的路径原样返回', () => {
        expect(rewriteLink('x', 'missing.md', dir)).toBe('[x](missing.md)');
    });

    it('./ 与 ../ 开头原样返回（不做向上解析）', () => {
        expect(rewriteLink('x', './target.md', dir)).toBe('[x](./target.md)');
        expect(rewriteLink('x', '../outside.md', dir)).toBe('[x](../outside.md)');
    });

    it('非法百分号编码原样返回', () => {
        expect(rewriteLink('x', '%E4%A', dir)).toBe('[x](%E4%A)');
    });
});

describe('rewriteLinks', () => {
    const dir = makeFixture({ 'a.md': '# A', 'b.md': '# B' });

    it('普通行改写，代码围栏内跳过', () => {
        const md = [
            '[ok](a.md)',
            '```',
            '[not-rewritten](b.md)',
            '```',
            '[after](b.md)'
        ].join('\n');
        const out = rewriteLinks(md, dir);
        expect(out).toContain('file://' + path.join(dir, 'a.md'));
        expect(out).toContain('[not-rewritten](b.md)'); // 围栏内不动
        expect(out).toContain('file://' + path.join(dir, 'b.md'));
    });

    it('围栏开关随 ``` 行切换', () => {
        const md = ['```js', '[in](a.md)', '```', '[out](a.md)'].join('\n');
        const out = rewriteLinks(md, dir);
        expect(out).toContain('[in](a.md)');
        expect(out).toContain('file://' + path.join(dir, 'a.md'));
    });
});

describe('markdownToHtml', () => {
    const dir = makeFixture({});

    it('title 中的 HTML 特殊字符转义', () => {
        const html = markdownToHtml('# x', '<script>&"', dir);
        expect(html).toContain('&lt;script&gt;&amp;&quot;');
        expect(html).not.toContain('<script>');
    });

    it('中文标题生成锚点 id（gfmHeadingId）', () => {
        const html = markdownToHtml('# 章节一\n\n正文', 't', dir);
        // 钉死实际生成的 id 形态
        expect(html).toMatch(/<h1 id="[^"]*"[^>]*>章节一<\/h1>/);
    });

    it('文档结构完整（doctype + style + 渲染后的 body）', () => {
        const html = markdownToHtml('# 标题\n\n**加粗**', 't', dir);
        expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
        expect(html).toContain('<strong>加粗</strong>');
        expect(html).toContain('@page');
    });
});

describe('findChrome', () => {
    it('配置路径存在 → 返回该路径', () => {
        const dir = makeFixture({ 'chrome': '' });
        const p = path.join(dir, 'chrome');
        expect(findChrome(p)).toBe(p);
    });

    it('配置路径不存在 → 抛错', () => {
        const dir = makeFixture({});
        expect(() => findChrome(path.join(dir, 'nope'))).toThrow('设置里的 Chrome 路径不存在');
    });

    it('CHROME_BIN 有效 → 返回；无效 → 忽略', () => {
        backupEnv('CHROME_BIN', 'PATH');
        const dir = makeFixture({ 'chrome': '' });
        const p = path.join(dir, 'chrome');

        process.env.CHROME_BIN = p;
        process.env.PATH = '/nonexistent';
        expect(findChrome(undefined, { candidates: [], onPath: [] })).toBe(p);

        process.env.CHROME_BIN = path.join(dir, 'nope');
        expect(findChrome(undefined, { candidates: [], onPath: [] })).toBeUndefined();
    });

    it('注入 candidates 列表按顺序命中', () => {
        backupEnv('CHROME_BIN');
        delete process.env.CHROME_BIN;
        const dir = makeFixture({ 'edge': '' });
        const p = path.join(dir, 'edge');
        expect(findChrome(undefined, { candidates: [p] })).toBe(p);
        expect(findChrome(undefined, { candidates: [path.join(dir, 'nope'), p] })).toBe(p);
    });

    it('PATH 探测命中 fixture（isExecutableFile 只查 isFile，不需要执行位）', () => {
        backupEnv('CHROME_BIN', 'PATH');
        delete process.env.CHROME_BIN;
        const dir = makeFixture({ 'google-chrome': '' });
        process.env.PATH = dir;
        expect(findChrome(undefined, { candidates: [], onPath: ['google-chrome'] })).toBe(
            path.join(dir, 'google-chrome')
        );
    });

    it('全部落空 → undefined', () => {
        backupEnv('CHROME_BIN', 'PATH');
        delete process.env.CHROME_BIN;
        process.env.PATH = '/nonexistent';
        expect(findChrome(undefined, { candidates: [], onPath: ['not-a-real-browser'] })).toBeUndefined();
    });
});
