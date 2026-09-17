/** 认证方式。 */
export type SshAuthMethod = 'password' | 'privateKey' | 'agent';

/**
 * 一台服务器的持久化记录。
 *
 * 这里只有**非敏感字段**：密码和私钥 passphrase 走 SecretStorage（系统钥匙串），
 * 私钥本身只记路径不记内容。为什么这么分，见 servers.ts 顶部的说明。
 */
export interface ServerRecord {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    authMethod: SshAuthMethod;
    /** authMethod === 'privateKey'：私钥文件路径 */
    privateKeyPath?: string;
    /** authMethod === 'agent'：agent socket 路径。留空表示连接时取 SSH_AUTH_SOCK */
    agentSocketPath?: string;
}

/**
 * 发给 webview 的形态。除了布尔标记外没有多余信息——
 * webview 是渲染层，没有任何理由拿到密码或 passphrase 的明文。
 */
export interface ServerListItem extends ServerRecord {
    hasStoredPassword: boolean;
    hasStoredPassphrase: boolean;
}

/**
 * webview 表单提交上来的内容。
 *
 * password / passphrase 为空表示「不改动已存的值」：留空即保留，
 * 填了才覆盖。代价是没法把密码改成空串，但 SSH 服务器本来也不接受空密码，
 * 真要清掉就删了服务器重加。
 */
export interface ServerDraft {
    id?: string;
    name: string;
    host: string;
    port: number | string;
    username: string;
    authMethod: SshAuthMethod;
    privateKeyPath?: string;
    agentSocketPath?: string;
    password?: string;
    passphrase?: string;
}

/** 会话状态。connecting → connected，之后要么 closed（正常断开）要么 error。 */
export type SessionStatus = 'connecting' | 'connected' | 'closed' | 'error';

/**
 * 表单字段级错误：键名与字段名一一对应，值是直接展示给用户的中文说明。
 * 空对象表示校验通过。定义放在这里而不是 validate.ts，是为了让协议文件
 * 能直接引用它，不必把一个纯数据形状拆到两处。
 */
export type FieldErrors = Partial<
    Record<'name' | 'host' | 'port' | 'username' | 'privateKeyPath', string>
>;
