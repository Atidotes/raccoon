import * as https from 'https';

/**
 * 余额接口地址写死在这里，不做成配置项。
 * 如果让它可配置，工作区里的 .vscode/settings.json 就能把请求指到第三方服务器，
 * 而请求头里带着 API Key —— 那等于给了仓库一个偷 Key 的口子。
 */
const BALANCE_URL = 'https://api.deepseek.com/user/balance';
const REQUEST_TIMEOUT_MS = 15_000;

export interface BalanceInfo {
    currency: string;
    totalBalance: string;
    grantedBalance: string;
    toppedUpBalance: string;
}

export interface Balance {
    /** 余额是否够用。false 表示后续 API 调用会被拒绝。 */
    isAvailable: boolean;
    infos: BalanceInfo[];
}

const CURRENCY_SYMBOLS: Record<string, string> = {
    CNY: '¥',
    USD: '$'
};

function asString(value: unknown): string {
    // 接口定义里金额是字符串（"110.00"），但多兼容一种形态不亏
    if (typeof value === 'string') {
        return value;
    }
    return typeof value === 'number' ? String(value) : '';
}

export function explainStatus(status: number, body: string): string {
    switch (status) {
        case 401:
            return 'API Key 无效或已撤销，请检查 raccoon.deepseek.apiKey';
        case 402:
            return '账户余额不足';
        case 429:
            return '请求过于频繁，请稍后再试';
        default: {
            const detail = body.trim().slice(0, 200);
            return detail ? `HTTP ${status}：${detail}` : `HTTP ${status}`;
        }
    }
}

function requestBalance(apiKey: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = https.request(
            BALANCE_URL,
            {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    Accept: 'application/json'
                }
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    const body = Buffer.concat(chunks).toString('utf8');
                    const status = res.statusCode ?? 0;
                    if (status >= 200 && status < 300) {
                        resolve(body);
                    } else {
                        reject(new Error(explainStatus(status, body)));
                    }
                });
            }
        );

        req.setTimeout(REQUEST_TIMEOUT_MS, () => {
            req.destroy(new Error(`请求超时（超过 ${REQUEST_TIMEOUT_MS / 1000} 秒）`));
        });
        req.on('error', reject);
        req.end();
    });
}

/** 解析余额接口的响应体（从 fetchBalance 拆出，独立成纯函数便于测试）。 */
export function parseBalance(body: string): Balance {
    let parsed: { is_available?: unknown; balance_infos?: unknown };
    try {
        parsed = JSON.parse(body) as typeof parsed;
    } catch {
        // 鉴权失败时接口返回的是纯文本（如 "Authentication Fails (governor)"），
        // 原样带出来，比统一报「解析失败」好排查得多
        throw new Error(`返回内容不是 JSON：${body.trim().slice(0, 200)}`);
    }

    const rawInfos = Array.isArray(parsed.balance_infos) ? parsed.balance_infos : [];

    return {
        isAvailable: parsed.is_available === true,
        infos: rawInfos.map((raw) => {
            const item = raw as Record<string, unknown>;
            return {
                currency: asString(item.currency),
                totalBalance: asString(item.total_balance),
                grantedBalance: asString(item.granted_balance),
                toppedUpBalance: asString(item.topped_up_balance)
            };
        })
    };
}

/** 查询账户余额。失败时抛出的 Error.message 是可直接展示给用户的中文说明。 */
export async function fetchBalance(apiKey: string): Promise<Balance> {
    const key = apiKey.trim();
    if (!key) {
        throw new Error('尚未配置 API Key');
    }

    const body = await requestBalance(key);
    return parseBalance(body);
}

/** 把 "110.00" + "CNY" 拼成 "¥110.00"。数值异常时退回原始字符串。 */
export function formatAmount(value: string, currency: string): string {
    const symbol = CURRENCY_SYMBOLS[currency] ?? (currency ? `${currency} ` : '');
    const amount = Number(value);
    return symbol + (Number.isFinite(amount) ? amount.toFixed(2) : value);
}

/**
 * 状态栏只放一个金额，挑一条来显示。优先级：
 *   1. 有余额的人民币
 *   2. 有余额的任意币种
 *   3. 人民币（哪怕为 0）
 *   4. 第一条
 *
 * 「有没有余额」排在币种前面，是因为状态栏要回答的是「我还有多少钱」。
 * 若某个币种账户里有余额，却因为另一个币种排在前面而显示 0，反而是误导。
 * 完整的多币种明细在悬停提示里都能看到。
 */
export function preferredInfo(balance: Balance): BalanceInfo | undefined {
    const hasMoney = (info: BalanceInfo) => Number(info.totalBalance) > 0;
    return (
        balance.infos.find((info) => info.currency === 'CNY' && hasMoney(info)) ??
        balance.infos.find(hasMoney) ??
        balance.infos.find((info) => info.currency === 'CNY') ??
        balance.infos[0]
    );
}
