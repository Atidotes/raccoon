import { createHash } from 'crypto';
import * as vscode from 'vscode';

const KEY_PREFIX = 'raccoon.ssh.knownHost.';

/**
 * 主机密钥指纹，形如 `SHA256:Abc123...`，与 `ssh-keygen -lf` 的输出格式一致。
 * 用同一套写法是为了能直接和运维给的指纹对照着看。
 */
export function fingerprint(key: Buffer): string {
    return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

export type HostKeyVerdict = 'new' | 'match' | 'mismatch';

/**
 * TOFU（Trust On First Use，首次连接即信任）。
 *
 * ssh2 默认**完全不校验主机密钥**，也就是对中间人攻击不设防：链路被劫持时，
 * 攻击者拿自己的密钥照样能握手成功，而我们毫无察觉。这里补上最基本的一道：
 * 第一次连某台机器时记住它的指纹，之后再连必须一致，不一致就断开并告警。
 *
 * 挡不住「第一次连的时候就已经被劫持」，但能挡住之后任何一次密钥替换——
 * 这是 TOFU 的固有边界，比自己算一遍指纹让用户核对要现实得多。
 */
export class KnownHosts {
    constructor(private readonly state: vscode.Memento) {}

    /** 校验并（首次）记住主机密钥。mismatch 由调用方负责拒绝连接。 */
    check(host: string, port: number, key: Buffer): HostKeyVerdict {
        const id = `${host}:${port}`;
        const actual = fingerprint(key);
        const seen = this.state.get<string>(KEY_PREFIX + id);

        if (!seen) {
            void this.state.update(KEY_PREFIX + id, actual);
            return 'new';
        }

        return seen === actual ? 'match' : 'mismatch';
    }
}
