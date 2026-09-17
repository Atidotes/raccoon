/**
 * DeepSeek 余额：纯函数测试（parseBalance / explainStatus / formatAmount / preferredInfo）。
 * fetchBalance 走真实 https 请求，不测。
 */
import { describe, expect, it } from 'vitest';
import {
    explainStatus,
    formatAmount,
    parseBalance,
    preferredInfo
} from '../../src/deepseek/balance';

describe('parseBalance', () => {
    it('完整合法 JSON 映射正确', () => {
        const body = JSON.stringify({
            is_available: true,
            balance_infos: [
                {
                    currency: 'CNY',
                    total_balance: '110.00',
                    granted_balance: '100.00',
                    topped_up_balance: '10.00'
                }
            ]
        });
        expect(parseBalance(body)).toEqual({
            isAvailable: true,
            infos: [
                {
                    currency: 'CNY',
                    totalBalance: '110.00',
                    grantedBalance: '100.00',
                    toppedUpBalance: '10.00'
                }
            ]
        });
    });

    it('is_available 缺失或 false → false', () => {
        expect(parseBalance('{}').isAvailable).toBe(false);
        expect(parseBalance('{"is_available": false}').isAvailable).toBe(false);
    });

    it('balance_infos 缺失或非数组 → 空列表', () => {
        expect(parseBalance('{"is_available": true}').infos).toEqual([]);
        expect(parseBalance('{"balance_infos": "oops"}').infos).toEqual([]);
    });

    it('金额为 number 时转字符串（接口定义是字符串，多兼容一种形态）', () => {
        const body = JSON.stringify({
            balance_infos: [{ currency: 'CNY', total_balance: 110 }]
        });
        expect(parseBalance(body).infos[0].totalBalance).toBe('110');
    });

    it('非法 JSON → 抛「返回内容不是 JSON：+ 截断原文」', () => {
        expect(() => parseBalance('not json at all')).toThrow('返回内容不是 JSON：not json at all');
    });

    it('鉴权失败的纯文本原样带出', () => {
        expect(() => parseBalance('Authentication Fails (governor)')).toThrow('Authentication Fails');
    });
});

describe('explainStatus', () => {
    it('401/402/429 的精确文案', () => {
        expect(explainStatus(401, '')).toBe('API Key 无效或已撤销，请检查 raccoon.deepseek.apiKey');
        expect(explainStatus(402, '')).toBe('账户余额不足');
        expect(explainStatus(429, '')).toBe('请求过于频繁，请稍后再试');
    });

    it('默认分支带 body → HTTP {code}：{detail}', () => {
        expect(explainStatus(500, 'internal error')).toBe('HTTP 500：internal error');
    });

    it('默认分支无 body → HTTP {code}', () => {
        expect(explainStatus(500, '')).toBe('HTTP 500');
    });

    it('body 超过 200 字符截断', () => {
        const long = 'x'.repeat(300);
        const msg = explainStatus(500, long);
        expect(msg).toContain('x'.repeat(200));
        expect(msg.length).toBeLessThan(210);
    });
});

describe('formatAmount', () => {
    it('¥ 与 $ 符号', () => {
        expect(formatAmount('110.00', 'CNY')).toBe('¥110.00');
        expect(formatAmount('5.5', 'USD')).toBe('$5.50');
    });

    it('未知币种显示币种代码前缀', () => {
        expect(formatAmount('1.5', 'EUR')).toBe('EUR 1.50');
    });

    it('数值异常时退回原始字符串', () => {
        expect(formatAmount('abc', 'CNY')).toBe('¥abc');
    });

    it('空字符串 → ¥0.00（Number 把空串当 0 的现状，钉死防止误改）', () => {
        expect(formatAmount('', 'CNY')).toBe('¥0.00');
    });
});

describe('preferredInfo 优先级', () => {
    const info = (currency: string, totalBalance: string) => ({
        currency,
        totalBalance,
        grantedBalance: '0',
        toppedUpBalance: '0'
    });

    it('有余额的 CNY 优先', () => {
        const b = { isAvailable: true, infos: [info('USD', '50.00'), info('CNY', '10.00')] };
        expect(preferredInfo(b)?.currency).toBe('CNY');
    });

    it('有余额的任意币种 > 为 0 的 CNY', () => {
        const b = { isAvailable: true, infos: [info('CNY', '0.00'), info('USD', '50.00')] };
        expect(preferredInfo(b)?.currency).toBe('USD');
    });

    it('CNY 为 0 > 其他币种为 0', () => {
        const b = { isAvailable: true, infos: [info('USD', '0.00'), info('CNY', '0.00')] };
        expect(preferredInfo(b)?.currency).toBe('CNY');
    });

    it('空数组 → undefined', () => {
        expect(preferredInfo({ isAvailable: true, infos: [] })).toBeUndefined();
    });
});
