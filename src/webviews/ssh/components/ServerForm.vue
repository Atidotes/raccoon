<script setup lang="ts">
/**
 * 新增 / 编辑服务器的表单。
 *
 * 校验以宿主为准：这里只做 required / min / max 这类即时反馈，
 * 真正的规则在 src/ssh/validate.ts，出错时由宿主回一条 formError 填到 errors 上。
 *
 * 密码框故意不回显已存的值（宿主根本不会把明文发过来）。留空 = 不改动，
 * 填了才覆盖，所以 hasStoredPassword 只用来提示「已经存过」。
 */
import { reactive } from 'vue';
import type {
    FieldErrors,
    ServerDraft,
    ServerListItem,
    SshTestResult
} from '../../../shared/protocol';

const props = defineProps<{
    /** 有值 = 编辑，无值 = 新建 */
    server?: ServerListItem;
    errors: FieldErrors;
    /** 「测试连接」进行中，按钮转圈禁用 */
    testing: boolean;
    /** 上一次测试连接的结果；null = 还没测过 */
    testResult: SshTestResult | null;
}>();

const emit = defineEmits<{
    save: [draft: ServerDraft];
    cancel: [];
    test: [draft: ServerDraft];
}>();

const draft = reactive<ServerDraft>({
    id: props.server?.id,
    name: props.server?.name ?? '',
    host: props.server?.host ?? '',
    port: props.server?.port ?? 22,
    username: props.server?.username ?? '',
    authMethod: props.server?.authMethod ?? 'password',
    privateKeyPath: props.server?.privateKeyPath ?? '',
    agentSocketPath: props.server?.agentSocketPath ?? '',
    password: '',
    passphrase: ''
});

const AUTH_OPTIONS = [
    { value: 'password', label: '密码' },
    { value: 'privateKey', label: '私钥文件' },
    { value: 'agent', label: 'ssh-agent' }
] as const;

function submit(): void {
    emit('save', { ...draft });
}
</script>

<template>
    <div class="overlay">
        <form class="card" @submit.prevent="submit">
            <h2>{{ server ? '编辑服务器' : '新增服务器' }}</h2>

            <label class="field">
                <span>名称</span>
                <input v-model="draft.name" type="text" placeholder="生产机" autofocus />
                <em v-if="errors.name">{{ errors.name }}</em>
            </label>

            <div class="row">
                <label class="field grow">
                    <span>主机</span>
                    <input v-model="draft.host" type="text" placeholder="10.0.0.1 或 example.com" />
                    <em v-if="errors.host">{{ errors.host }}</em>
                </label>

                <label class="field port">
                    <span>端口</span>
                    <!-- 文本输入而非 number：数字框的上下箭头在这里纯属添乱，
                         合法性由宿主 parsePort 把关，1–65535 之外会回填错误 -->
                    <input
                        v-model="draft.port"
                        type="text"
                        inputmode="numeric"
                        placeholder="22"
                    />
                    <em v-if="errors.port">{{ errors.port }}</em>
                </label>
            </div>

            <label class="field">
                <span>用户名</span>
                <input v-model="draft.username" type="text" placeholder="root" />
                <em v-if="errors.username">{{ errors.username }}</em>
            </label>

            <fieldset class="field">
                <legend>认证方式</legend>
                <div class="radios">
                    <label v-for="option in AUTH_OPTIONS" :key="option.value" class="radio">
                        <input v-model="draft.authMethod" type="radio" :value="option.value" />
                        <span>{{ option.label }}</span>
                    </label>
                </div>
            </fieldset>

            <template v-if="draft.authMethod === 'password'">
                <label class="field">
                    <span>密码</span>
                    <input
                        v-model="draft.password"
                        type="password"
                        :placeholder="server?.hasStoredPassword ? '已保存，留空则不修改' : '登录密码'"
                    />
                    <em class="hint">密码存在系统钥匙串里，不会写进配置文件。</em>
                </label>
            </template>

            <template v-else-if="draft.authMethod === 'privateKey'">
                <label class="field">
                    <span>私钥文件</span>
                    <input
                        v-model="draft.privateKeyPath"
                        type="text"
                        placeholder="~/.ssh/id_ed25519"
                    />
                    <em v-if="errors.privateKeyPath">{{ errors.privateKeyPath }}</em>
                    <em v-else class="hint">填路径，私钥内容不会被读取保存，只在连接时现读。</em>
                </label>

                <label class="field">
                    <span>私钥 passphrase</span>
                    <input
                        v-model="draft.passphrase"
                        type="password"
                        :placeholder="server?.hasStoredPassphrase ? '已保存，留空则不修改' : '没有就留空'"
                    />
                </label>
            </template>

            <template v-else>
                <label class="field">
                    <span>agent socket 路径</span>
                    <input v-model="draft.agentSocketPath" type="text" placeholder="留空则用 SSH_AUTH_SOCK" />
                    <em class="hint">
                        从 Dock 启动的 VS Code 可能读不到 SSH_AUTH_SOCK，这种情况在这里手动填。
                    </em>
                </label>
            </template>

            <div class="actions">
                <button
                    type="button"
                    class="ghost"
                    :disabled="testing"
                    @click="emit('test', { ...draft })"
                >
                    {{ testing ? '测试中…' : '测试连接' }}
                </button>

                <p v-if="testResult" class="test-result" :class="testResult.ok ? 'ok' : 'fail'">
                    {{ testResult.ok ? '连接成功' : `连接失败：${testResult.detail ?? '未知原因'}` }}
                </p>

                <div class="right">
                    <button type="button" class="ghost" @click="emit('cancel')">取消</button>
                    <button type="submit" class="primary">{{ server ? '保存' : '添加' }}</button>
                </div>
            </div>
        </form>
    </div>
</template>

<style scoped>
.overlay {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.45);
}

.card {
    width: min(460px, 92%);
    max-height: 92%;
    overflow-y: auto;
    padding: 20px 22px;
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    border-radius: 6px;
    background: var(--vscode-editorWidget-background, #252526);
    color: var(--vscode-editor-foreground, #ccc);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
    font-family: var(--vscode-font-family, sans-serif);
    font-size: 13px;
}

h2 {
    margin: 0 0 16px;
    font-size: 15px;
    font-weight: 600;
}

.field {
    display: block;
    margin: 0 0 14px;
    border: 0;
    padding: 0;
}

.field > span,
.field > legend {
    display: block;
    margin-bottom: 5px;
    padding: 0;
    color: var(--vscode-descriptionForeground, #999);
    font-size: 12px;
}

.row {
    display: flex;
    gap: 16px;
}

.grow {
    flex: 1;
}

.port {
    width: 92px;
}

input[type='text'],
input[type='password'],
input[type='number'] {
    width: 100%;
    padding: 5px 8px;
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    border-radius: 3px;
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #ccc);
    font-family: inherit;
    font-size: 13px;
}

input:focus {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: -1px;
}

.radios {
    display: flex;
    gap: 16px;
}

.radio {
    display: flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
}

em {
    display: block;
    margin-top: 4px;
    color: var(--vscode-errorForeground, #f48771);
    font-size: 12px;
    font-style: normal;
}

em.hint {
    color: var(--vscode-descriptionForeground, #999);
}

.actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 18px;
}

.right {
    display: flex;
    gap: 8px;
    margin-left: auto;
}

.test-result {
    margin: 0;
    font-size: 12px;
}

.test-result.ok {
    color: var(--vscode-charts-green, #89d185);
}

.test-result.fail {
    color: var(--vscode-errorForeground, #f48771);
}

button:disabled {
    opacity: 0.5;
    cursor: default;
}

button {
    padding: 5px 14px;
    border: 1px solid transparent;
    border-radius: 3px;
    cursor: pointer;
    font-family: inherit;
    font-size: 13px;
}

.primary {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
}

.primary:hover {
    background: var(--vscode-button-hoverBackground, #1177bb);
}

.ghost {
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #ccc);
}

.ghost:hover {
    background: var(--vscode-button-secondaryHoverBackground, #45494e);
}
</style>
