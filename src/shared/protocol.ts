/**
 * webview ↔ 宿主的消息协议，两端共用。
 *
 * 注意：webview 与宿主跑在两个进程里，不能共享任何运行时代码——跨边界的
 * import 只能是 import type（编译期擦除）或纯常量（各自打包一份）。所以
 * 这个文件里只有类型和消息名常量，不要往里加函数。
 */

// SSH 面板的数据模型定义在 src/ssh/types.ts，这里只借用类型（编译期擦除，不进产物），
// 顺带 re-export 给 webview 侧用
import type { FieldErrors, ServerDraft, ServerListItem, SessionStatus } from '../ssh/types';

export type {
    FieldErrors,
    ServerDraft,
    ServerListItem,
    ServerRecord,
    SessionStatus
} from '../ssh/types';

export const MSG_READY = 'ready';
export const MSG_HIGH_SCORE = 'highScore';
export const MSG_GAME_OVER = 'gameOver';
/** 宿主 → webview：当前配色是深色还是浅色（Visual Studio 宿主专用，见下） */
export const MSG_THEME = 'theme';

export const THEME_LIGHT = 'light';
export const THEME_DARK = 'dark';

/**
 * 配色种类。
 *
 * VS Code 会把 --vscode-* 变量直接注入页面，前端不需要宿主告诉它主题；
 * Visual Studio 的 WebView2 没有这套注入，且它的 prefers-color-scheme 跟的是
 * Windows 系统主题而不是 VS 主题——深色 VS + 浅色系统的组合会瞬间闪瞎。
 * 所以 C# 侧在 webview 就绪后补发这条消息，前端据此切 theme.css 里的调色板。
 */
export type ThemeKind = typeof THEME_LIGHT | typeof THEME_DARK;

export interface ThemeMessage {
    command: typeof MSG_THEME;
    theme: ThemeKind;
}

export interface ReadyMessage {
    command: typeof MSG_READY;
}

export interface HighScoreMessage {
    command: typeof MSG_HIGH_SCORE;
    value: number;
}

export interface GameOverMessage {
    command: typeof MSG_GAME_OVER;
    score: number;
    /** 俄罗斯方块：消行数（贪吃蛇不发这个字段） */
    lines?: number;
    /** 贪吃蛇：长度（俄罗斯方块不发这个字段） */
    length?: number;
    /** 贪吃蛇：等级 */
    level?: number;
    /** 贪吃蛇：吃满整盘的通关 */
    win?: boolean;
}

/* ==================================================== SSH 连接面板
 *
 * 消息名统一带 ssh: 前缀。三个游戏面板和 SSH 面板各自是独立的 webview，
 * 消息不会串台，前缀纯粹是为了看日志时一眼能分清是谁发的。
 *
 * 这里只 import type——ServerDraft 这些是纯类型，编译期就被擦掉了，
 * 不会有宿主的代码被打进 webview。类型本身定义在 src/ssh/types.ts。
 */

/** webview → 宿主：面板就绪，请求服务器列表 */
export const MSG_SSH_READY = 'ssh:ready';
/** webview → 宿主：新增/保存一台服务器 */
export const MSG_SSH_SAVE = 'ssh:saveServer';
/** webview → 宿主：删除一台服务器 */
export const MSG_SSH_DELETE = 'ssh:deleteServer';
/** webview → 宿主：新建一个会话并连接 */
export const MSG_SSH_CONNECT = 'ssh:connect';
/** webview → 宿主：主动断开会话 */
export const MSG_SSH_CLOSE = 'ssh:closeSession';
/** webview → 宿主：键盘输入 */
export const MSG_SSH_INPUT = 'ssh:input';
/** webview → 宿主：终端尺寸变化 */
export const MSG_SSH_RESIZE = 'ssh:resize';
/** webview → 宿主：用表单当前内容（含未保存的密码）试连一次 */
export const MSG_SSH_TEST = 'ssh:testConnection';

/** 宿主 → webview：服务器列表（含增删改后的最新快照） */
export const MSG_SSH_SERVERS = 'ssh:servers';
/** 宿主 → webview：会话状态变化 */
export const MSG_SSH_STATUS = 'ssh:status';
/** 宿主 → webview：终端输出 */
export const MSG_SSH_DATA = 'ssh:data';
/** 宿主 → webview：测试连接的结果 */
export const MSG_SSH_TEST_RESULT = 'ssh:testResult';

export interface SshReadyMessage {
    command: typeof MSG_SSH_READY;
}

export interface SshSaveMessage {
    command: typeof MSG_SSH_SAVE;
    draft: ServerDraft;
}

export interface SshDeleteMessage {
    command: typeof MSG_SSH_DELETE;
    id: string;
}

export interface SshConnectMessage {
    command: typeof MSG_SSH_CONNECT;
    sessionId: string;
    serverId: string;
    cols: number;
    rows: number;
}

export interface SshCloseMessage {
    command: typeof MSG_SSH_CLOSE;
    sessionId: string;
}

export interface SshInputMessage {
    command: typeof MSG_SSH_INPUT;
    sessionId: string;
    data: string;
}

export interface SshResizeMessage {
    command: typeof MSG_SSH_RESIZE;
    sessionId: string;
    cols: number;
    rows: number;
}

/**
 * 测试连接：draft 就是表单当前内容。注意它会带着用户刚输进去的密码过消息
 * 边界——这是「测试登录是否成功」的必要条件，宿主用完即丢，不落任何存储。
 */
export interface SshTestMessage {
    command: typeof MSG_SSH_TEST;
    draft: ServerDraft;
}

/** 宿主 → webview：最新服务器列表 */
export interface SshServersMessage {
    command: typeof MSG_SSH_SERVERS;
    servers: ServerListItem[];
}

/** 宿主 → webview：会话状态。detail 只在 error 时带，是要展示给用户的说明。 */
export interface SshStatusMessage {
    command: typeof MSG_SSH_STATUS;
    sessionId: string;
    status: SessionStatus;
    detail?: string;
}

export interface SshDataMessage {
    command: typeof MSG_SSH_DATA;
    sessionId: string;
    data: string;
}

/** 测试连接的结果。ok=false 时 detail 是给人看的一句话原因。 */
export interface SshTestResultMessage {
    command: typeof MSG_SSH_TEST_RESULT;
    ok: boolean;
    detail?: string;
}

/** 表单上「测试连接」按钮的状态和结果，网页侧组件直接用。 */
export interface SshTestResult {
    ok: boolean;
    detail?: string;
}

/** 宿主 → webview：表单没通过校验，逐字段回填错误 */
export const MSG_SSH_FORM_ERROR = 'ssh:formError';

export interface SshFormErrorMessage {
    command: typeof MSG_SSH_FORM_ERROR;
    errors: FieldErrors;
}

/** webview → 宿主 */
export type WebviewToHost =
    | ReadyMessage
    | GameOverMessage
    | SshReadyMessage
    | SshSaveMessage
    | SshDeleteMessage
    | SshConnectMessage
    | SshCloseMessage
    | SshInputMessage
    | SshResizeMessage
    | SshTestMessage;

/** 宿主 → webview */
export type HostToWebview =
    | ThemeMessage
    | HighScoreMessage
    | SshServersMessage
    | SshStatusMessage
    | SshDataMessage
    | SshFormErrorMessage
    | SshTestResultMessage;
