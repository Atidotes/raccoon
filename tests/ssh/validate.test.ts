/**
 * SSH 表单校验的纯函数测试。
 * 真正的连接（sessionManager / servers）依赖 vscode 与 ssh2，不在这里测。
 */
import { describe, expect, it } from 'vitest';
import {
    normalizeHost,
    parseAuthMethod,
    parsePort,
    validateDraft,
    validateHost
} from '../../src/ssh/validate';
import type { ServerDraft } from '../../src/ssh/types';

/** 一份能过校验的草稿，各用例只改自己要测的字段 */
const validDraft = (patch: Partial<ServerDraft> = {}): ServerDraft => ({
    name: '生产机',
    host: '10.0.0.1',
    port: 22,
    username: 'root',
    authMethod: 'password',
    ...patch
});

describe('parsePort', () => {
    it('接受数字和纯数字字符串', () => {
        expect(parsePort(22)).toBe(22);
        expect(parsePort('2222')).toBe(2222);
        expect(parsePort(' 22 ')).toBe(22);
    });

    it('拒绝越界端口', () => {
        expect(parsePort(0)).toBeUndefined();
        expect(parsePort(65536)).toBeUndefined();
        expect(parsePort(-1)).toBeUndefined();
    });

    it('拒绝非整数和非数字', () => {
        expect(parsePort(22.5)).toBeUndefined();
        expect(parsePort('abc')).toBeUndefined();
        expect(parsePort('22abc')).toBeUndefined();
        expect(parsePort('')).toBeUndefined();
        expect(parsePort(undefined)).toBeUndefined();
        expect(parsePort(null)).toBeUndefined();
    });

    it('边界值 1 和 65535 有效', () => {
        expect(parsePort(1)).toBe(1);
        expect(parsePort(65535)).toBe(65535);
    });
});

describe('validateHost', () => {
    it('常规主机名和地址通过', () => {
        expect(validateHost('example.com')).toBeUndefined();
        expect(validateHost('10.0.0.1')).toBeUndefined();
        expect(validateHost('::1')).toBeUndefined();
        expect(validateHost('[::1]')).toBeUndefined();
        expect(validateHost('db-internal_1')).toBeUndefined();
    });

    it('为空或全空白时报错', () => {
        expect(validateHost('')).toBeTruthy();
        expect(validateHost('   ')).toBeTruthy();
        expect(validateHost(undefined)).toBeTruthy();
    });

    it('含空格、@ 或斜杠时报错', () => {
        expect(validateHost('10.0.0.1 22')).toBeTruthy();
        expect(validateHost('root@10.0.0.1')).toBeTruthy();
        expect(validateHost('ssh://10.0.0.1')).toBeTruthy();
    });
});

describe('normalizeHost', () => {
    it('去掉 IPv6 的方括号', () => {
        expect(normalizeHost('[::1]')).toBe('::1');
        expect(normalizeHost('  [fe80::1]  ')).toBe('fe80::1');
    });

    it('普通主机名只做 trim', () => {
        expect(normalizeHost('  10.0.0.1 ')).toBe('10.0.0.1');
    });
});

describe('parseAuthMethod', () => {
    it('已知取值原样返回', () => {
        expect(parseAuthMethod('password')).toBe('password');
        expect(parseAuthMethod('privateKey')).toBe('privateKey');
        expect(parseAuthMethod('agent')).toBe('agent');
    });

    it('未知取值退回 password', () => {
        expect(parseAuthMethod('keyboard-interactive')).toBe('password');
        expect(parseAuthMethod(undefined)).toBe('password');
        expect(parseAuthMethod(42)).toBe('password');
    });
});

describe('validateDraft', () => {
    it('完整草稿无错误', () => {
        expect(validateDraft(validDraft())).toEqual({});
    });

    it('缺名字、主机、用户名分别报对应字段', () => {
        expect(validateDraft(validDraft({ name: '  ' }))).toHaveProperty('name');
        expect(validateDraft(validDraft({ host: '' }))).toHaveProperty('host');
        expect(validateDraft(validDraft({ username: '' }))).toHaveProperty('username');
    });

    it('端口非法时报 port', () => {
        expect(validateDraft(validDraft({ port: 0 }))).toHaveProperty('port');
        expect(validateDraft(validDraft({ port: 'abc' }))).toHaveProperty('port');
    });

    it('只有私钥认证才要求私钥路径', () => {
        expect(validateDraft(validDraft({ authMethod: 'privateKey' }))).toHaveProperty(
            'privateKeyPath'
        );
        expect(
            validateDraft(validDraft({ authMethod: 'privateKey', privateKeyPath: '~/.ssh/id_ed25519' }))
        ).toEqual({});
        // 密码认证时路径为空不算错
        expect(validateDraft(validDraft({ authMethod: 'password', privateKeyPath: '' }))).toEqual({});
    });

    it('agent 认证不要求密码或私钥路径', () => {
        expect(validateDraft(validDraft({ authMethod: 'agent' }))).toEqual({});
    });

    it('多个字段同时出错时都报出来', () => {
        const errors = validateDraft({ name: '', host: '', port: 0, username: '', authMethod: 'password' });
        expect(Object.keys(errors).sort()).toEqual(['host', 'name', 'port', 'username']);
    });
});
