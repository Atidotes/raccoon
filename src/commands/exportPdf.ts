import * as path from 'path';
import * as vscode from 'vscode';
import { convertMarkdownToPdf } from '../markdown/markdownToPdf';

/** 优先用右键传进来的文件，否则退回当前编辑器里的 Markdown 文件。 */
function resolveTargetUri(arg?: vscode.Uri): vscode.Uri | undefined {
    if (arg && arg.scheme === 'file' && /\.md$/i.test(arg.fsPath)) {
        return arg;
    }

    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.scheme === 'file' && /\.md$/i.test(editor.document.uri.fsPath)) {
        return editor.document.uri;
    }

    return undefined;
}

/** 解析输出路径：留空则与 Markdown 文件同目录同名。 */
function resolveOutputPath(mdUri: vscode.Uri): string {
    const configured = vscode.workspace
        .getConfiguration('raccoon', mdUri)
        .get<string>('pdf.outputPath', '')
        .trim();

    const defaultName = path.basename(mdUri.fsPath).replace(/\.md$/i, '') + '.pdf';

    if (!configured) {
        return path.join(path.dirname(mdUri.fsPath), defaultName);
    }

    // 相对路径基于工作区根目录；没有工作区就基于 Markdown 文件所在目录
    const base = vscode.workspace.getWorkspaceFolder(mdUri)?.uri.fsPath ?? path.dirname(mdUri.fsPath);
    const resolved = path.isAbsolute(configured) ? configured : path.resolve(base, configured);

    return /\.pdf$/i.test(resolved) ? resolved : path.join(resolved, defaultName);
}

export async function exportPdf(arg?: vscode.Uri): Promise<void> {
    const mdUri = resolveTargetUri(arg);
    if (!mdUri) {
        void vscode.window.showWarningMessage(
            '请先打开一个 Markdown 文件，或在文件管理器里右键 .md 文件后选择「导出为 PDF」。'
        );
        return;
    }

    const outputPath = resolveOutputPath(mdUri);
    const chromePath = vscode.workspace
        .getConfiguration('raccoon', mdUri)
        .get<string>('pdf.chromePath', '');

    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `正在导出 ${path.basename(outputPath)}`,
                cancellable: false
            },
            () =>
                convertMarkdownToPdf({
                    markdownPath: mdUri.fsPath,
                    outputPath,
                    chromePath
                })
        );
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`导出 PDF 失败：${detail}`);
        return;
    }

    const openAction = '打开 PDF';
    const choice = await vscode.window.showInformationMessage(`已导出：${outputPath}`, openAction);
    if (choice === openAction) {
        void vscode.env.openExternal(vscode.Uri.file(outputPath));
    }
}
