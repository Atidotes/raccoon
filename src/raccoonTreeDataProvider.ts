import * as vscode from 'vscode';

interface Feature {
    label: string;
    /** 显示在标签右侧的短文本 */
    description: string;
    /** 悬停说明 */
    tooltip: string;
    /** codicon 名称 */
    icon: string;
    command: string;
}

/**
 * 侧边栏列出的功能入口。
 * 加新工具时在这里补一条即可，命令本身照常要在 package.json 的 contributes.commands 里声明。
 */
const FEATURES: Feature[] = [
    {
        label: 'Markdown 导出 PDF',
        description: '当前文件',
        tooltip: '把当前 Markdown 文件转成 PDF，输出到同目录',
        icon: 'file-pdf',
        command: 'raccoon.exportPdf'
    },
    {
        label: 'DeepSeek 余额',
        description: '查询账户',
        tooltip: '立即查询 DeepSeek 账户余额',
        icon: 'credit-card',
        command: 'raccoon.refreshBalance'
    },
    {
        label: '俄罗斯方块',
        description: '复古 CRT',
        tooltip: '在编辑器旁边开一局复古 CRT 风格的俄罗斯方块',
        icon: 'game',
        command: 'raccoon.startTetris'
    },
    {
        label: '五子棋',
        description: '人机对战',
        tooltip: '在编辑器旁边开一局人机对战的五子棋，你执黑先行',
        icon: 'target',
        command: 'raccoon.startGomoku'
    },
    {
        label: '贪吃蛇',
        description: '复古 CRT',
        tooltip: '在编辑器旁边开一局复古 CRT 风格的贪吃蛇，方向键转向',
        icon: 'snake',
        command: 'raccoon.startSnake'
    },
    {
        label: 'SSH 连接',
        description: '远程服务器',
        tooltip: '在编辑器区域打开 SSH 面板，管理服务器并开内嵌终端',
        icon: 'remote-explorer',
        command: 'raccoon.ssh'
    }
];

/**
 * 侧边栏视图的数据源。
 *
 * 列表是静态的，所以这里没有实现 onDidChangeTreeData —— 数据不会变，
 * 刷新机制挂在这里就只是死代码。将来某个入口要展示动态状态时再加。
 */
export class RaccoonTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
        // 不做嵌套，展开任何节点都返回空
        if (element) {
            return [];
        }

        return FEATURES.map((feature) => {
            const item = new vscode.TreeItem(feature.label, vscode.TreeItemCollapsibleState.None);
            item.description = feature.description;
            item.tooltip = feature.tooltip;
            item.iconPath = new vscode.ThemeIcon(feature.icon);
            item.command = { title: feature.label, command: feature.command };
            return item;
        });
    }
}
