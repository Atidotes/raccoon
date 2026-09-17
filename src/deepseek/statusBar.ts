import * as vscode from 'vscode';
import { Balance, BalanceInfo, fetchBalance, formatAmount, preferredInfo } from './balance';

const CONFIG_SECTION = 'raccoon';
const CONFIG_KEY = `${CONFIG_SECTION}.deepseek`;
const DEFAULT_INTERVAL_MINUTES = 10;

/** 低于这个数就把状态栏标黄，提醒该充值了。想改成别的值就改这里。 */
const LOW_BALANCE_THRESHOLD = 10;

function readConfig(): { apiKey: string; intervalMinutes: number } {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const interval = config.get<number>('deepseek.refreshIntervalMinutes', DEFAULT_INTERVAL_MINUTES);
    return {
        apiKey: config.get<string>('deepseek.apiKey', '').trim(),
        // 兜底成默认值，避免有人填 0 或负数导致疯狂轮询
        intervalMinutes: Number.isFinite(interval) && interval > 0 ? interval : DEFAULT_INTERVAL_MINUTES
    };
}

function formatTime(date: Date | undefined): string {
    if (!date) {
        return '尚未成功获取';
    }
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export class DeepSeekBalanceStatusBar implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;
    private timer: NodeJS.Timeout | undefined;
    private configListener: vscode.Disposable | undefined;
    private lastUpdated: Date | undefined;

    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    }

    start(): void {
        this.item.show();
        this.configListener = vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(CONFIG_KEY)) {
                this.scheduleAutoRefresh();
                void this.refresh();
            }
        });
        this.scheduleAutoRefresh();
        void this.refresh();
    }

    refresh(): void {
        const { apiKey } = readConfig();

        if (!apiKey) {
            this.renderNotConfigured();
            return;
        }

        this.renderLoading();

        fetchBalance(apiKey)
            .then((balance) => this.renderBalance(balance))
            .catch((error: unknown) => this.renderError(error));
    }

    dispose(): void {
        this.stopTimer();
        this.configListener?.dispose();
        this.item.dispose();
    }

    // ---------------------------------------------------------------- 渲染

    private renderNotConfigured(): void {
        // @id: 前缀让设置界面直接定位到 raccoon.deepseek.apiKey 这一项
        this.item.command = {
            title: '打开设置',
            command: 'workbench.action.openSettings',
            arguments: ['@id:raccoon.deepseek.apiKey']
        };
        this.item.text = '$(credit-card) 未配置';
        this.item.backgroundColor = undefined;
        this.item.tooltip = new vscode.MarkdownString(
            '**DeepSeek 余额**\n\n尚未配置 API Key。\n\n点击打开设置，填入 `raccoon.deepseek.apiKey`。'
        );
        this.lastUpdated = undefined;
    }

    private renderLoading(): void {
        this.item.command = 'raccoon.refreshBalance';
        this.item.text = '$(sync~spin) 查询中';
        this.item.backgroundColor = undefined;
        this.item.tooltip = '正在查询 DeepSeek 余额…';
    }

    private renderError(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this.item.command = 'raccoon.refreshBalance';
        this.item.text = '$(warning) 获取失败';
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.item.tooltip = new vscode.MarkdownString(
            `**DeepSeek 余额获取失败**\n\n${message}\n\n点击重试。`
        );
    }

    private renderBalance(balance: Balance): void {
        const info = preferredInfo(balance);
        if (!info) {
            this.renderError(new Error('接口没有返回任何余额信息'));
            return;
        }

        this.lastUpdated = new Date();
        this.item.command = 'raccoon.refreshBalance';
        this.item.text = `$(credit-card) ${formatAmount(info.totalBalance, info.currency)}`;

        const low = Number(info.totalBalance) < LOW_BALANCE_THRESHOLD;
        this.item.backgroundColor =
            !balance.isAvailable || low
                ? new vscode.ThemeColor('statusBarItem.warningBackground')
                : undefined;

        this.item.tooltip = this.buildTooltip(balance);
    }

    private buildTooltip(balance: Balance): vscode.MarkdownString {
        const lines: string[] = ['**DeepSeek 余额**', ''];

        for (const info of balance.infos) {
            lines.push(this.describe(info, balance.infos.length > 1));
        }

        lines.push('');
        if (!balance.isAvailable) {
            lines.push('$(warning) 余额不足，后续 API 调用会被拒绝');
            lines.push('');
        }
        lines.push(`${formatTime(this.lastUpdated)} 更新 · 点击刷新`);

        return new vscode.MarkdownString(lines.join('\n'));
    }

    private describe(info: BalanceInfo, showCurrency: boolean): string {
        const suffix = showCurrency && info.currency ? `（${info.currency}）` : '';
        const total = formatAmount(info.totalBalance, info.currency);
        const granted = formatAmount(info.grantedBalance, info.currency);
        const topped = formatAmount(info.toppedUpBalance, info.currency);

        return [`- 总计 **${total}**${suffix}`, `  - 赠送 ${granted}`, `  - 充值 ${topped}`].join('\n');
    }

    // ------------------------------------------------------------ 定时刷新

    private scheduleAutoRefresh(): void {
        this.stopTimer();
        const { intervalMinutes } = readConfig();
        this.timer = setInterval(() => this.refresh(), intervalMinutes * 60_000);
    }

    private stopTimer(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }
}
