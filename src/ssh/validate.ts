import { FieldErrors, ServerDraft, SshAuthMethod } from './types';

export const DEFAULT_PORT = 22;

const AUTH_METHODS: readonly SshAuthMethod[] = ['password', 'privateKey', 'agent'];

/** webview 传来的值不可信，认证方式要收敛到已知取值。 */
export function parseAuthMethod(value: unknown): SshAuthMethod {
    return AUTH_METHODS.includes(value as SshAuthMethod) ? (value as SshAuthMethod) : 'password';
}

/** 端口：接受数字或纯数字字符串，返回 1–65535 的整数；其余情况返回 undefined。 */
export function parsePort(value: unknown): number | undefined {
    const port =
        typeof value === 'string'
            ? /^\d+$/.test(value.trim())
                ? Number(value.trim())
                : NaN
            : value;

    if (typeof port !== 'number' || !Number.isInteger(port)) {
        return undefined;
    }
    return port >= 1 && port <= 65535 ? port : undefined;
}

/**
 * 主机名或地址：域名、IPv4、IPv6（裸写或 [] 包起来）都要能过。
 *
 * 这里只挡明显非法的字符，不做严格的格式校验——内网里合法的主机名五花八门，
 * 卡太严会把用户自己真正在用的机器挡在门外，而写错了主机名，连接失败时
 * 系统给的那句报错比格式校验有用得多。
 */
export function validateHost(value: unknown): string | undefined {
    if (typeof value !== 'string' || !value.trim()) {
        return '请填写主机地址';
    }
    if (/[\s@/\\]/.test(value.trim())) {
        return '主机地址里不能有空格、@ 或斜杠';
    }
    return undefined;
}

/** 去掉 IPv6 的方括号：表单里写 [::1] 不容易看错，但 ssh2 要的是裸地址。 */
export function normalizeHost(value: string): string {
    const host = value.trim();
    return /^\[[^\]]+\]$/.test(host) ? host.slice(1, -1) : host;
}

/** 校验表单。返回空对象即通过；宿主要拿它兜底，不能只靠 webview 拦。 */
export function validateDraft(draft: ServerDraft): FieldErrors {
    const errors: FieldErrors = {};

    if (typeof draft.name !== 'string' || !draft.name.trim()) {
        errors.name = '请给这台机器起个名字';
    }

    const hostError = validateHost(draft.host);
    if (hostError) {
        errors.host = hostError;
    }

    if (parsePort(draft.port) === undefined) {
        errors.port = '端口必须是 1–65535 之间的整数';
    }

    if (typeof draft.username !== 'string' || !draft.username.trim()) {
        errors.username = '请填写登录用户名';
    }

    if (parseAuthMethod(draft.authMethod) === 'privateKey') {
        if (typeof draft.privateKeyPath !== 'string' || !draft.privateKeyPath.trim()) {
            errors.privateKeyPath = '请填写私钥文件路径';
        }
    }

    return errors;
}
