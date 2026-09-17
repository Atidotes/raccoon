import * as vscode from 'vscode';
import { exportPdf } from './commands/exportPdf';
import { DeepSeekBalanceStatusBar } from './deepseek/statusBar';
import { startGomoku } from './gomoku/startGomoku';
import { startSnake } from './snake/startSnake';
import { startGame } from './tetris/startGame';
import { startSsh } from './ssh/startSsh';
import { RaccoonTreeDataProvider } from './raccoonTreeDataProvider';

export function activate(context: vscode.ExtensionContext): void {
    // 侧边栏：功能入口索引，点击即执行对应命令。
    // 列表是扁平的，所以不开 showCollapseAll。
    const treeView = vscode.window.createTreeView('raccoon.mainView', {
        treeDataProvider: new RaccoonTreeDataProvider()
    });

    // 状态栏：DeepSeek 余额
    const balanceStatusBar = new DeepSeekBalanceStatusBar();
    balanceStatusBar.start();

    context.subscriptions.push(
        treeView,
        balanceStatusBar,

        // 新增命令：在 src/ 下对应模块里实现，回到这里注册一行，再去 package.json 声明。
        // arg 由右键菜单传入；从命令面板或侧边栏调用时为空，此时退回当前编辑器。
        vscode.commands.registerCommand('raccoon.exportPdf', (arg?: vscode.Uri) => exportPdf(arg)),
        vscode.commands.registerCommand('raccoon.refreshBalance', () => balanceStatusBar.refresh()),
        vscode.commands.registerCommand('raccoon.startTetris', () => startGame(context)),
        vscode.commands.registerCommand('raccoon.startGomoku', () => startGomoku(context)),
        vscode.commands.registerCommand('raccoon.startSnake', () => startSnake(context)),
        vscode.commands.registerCommand('raccoon.ssh', () => startSsh(context))
    );
}

export function deactivate(): void {
    // 所有资源都挂在 context.subscriptions 上，VS Code 会自动释放，这里无需手动清理。
}
