<script setup lang="ts">
/**
 * SSH 连接面板：主页全屏展示服务器列表，点任意一台连接后整页切换成全屏终端。
 *
 * 终端页用 v-show 而不是 v-if 保持挂载——卸载会连 xterm 实例和回滚缓冲一起
 * 丢掉，返回列表再切回来就只剩一张白屏。会话在宿主侧也保持连接，返回列表
 * 不等于断开，所以主页的卡片上会显示对应标签的状态点。
 *
 * 这个组件只做编排——列表和终端分别交给 ServerForm.vue / TerminalTabs.vue，
 * 标签的状态流转在 logic/sessions.ts。跟宿主的所有往来都走 ssh:* 消息。
 */
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import {
    MSG_SSH_CLOSE,
    MSG_SSH_CONNECT,
    MSG_SSH_DATA,
    MSG_SSH_DELETE,
    MSG_SSH_FORM_ERROR,
    MSG_SSH_INPUT,
    MSG_SSH_READY,
    MSG_SSH_RESIZE,
    MSG_SSH_SAVE,
    MSG_SSH_SERVERS,
    MSG_SSH_STATUS,
    MSG_SSH_TEST,
    MSG_SSH_TEST_RESULT
} from '../../shared/protocol';
import type {
    FieldErrors,
    HostToWebview,
    ServerDraft,
    ServerListItem,
    SshTestResult
} from '../../shared/protocol';
import { useVsCodeApi } from '../shared/vscode';
import ServerForm from './components/ServerForm.vue';
import TerminalTabs from './components/TerminalTabs.vue';
import {
    addTab,
    activateTab,
    closeTab,
    closeTabsForMissingServers,
    emptyTabs,
    setStatus,
    statusBadge
} from './logic/sessions';
import type { TabsState } from './logic/sessions';

/**
 * 连接时先按 80x24 报一个尺寸。终端建好后 xterm 的首帧 fit 会算出真实行列数
 * 并发 resize 过来纠正，通常远早于 SSH 握手完成。
 */
const INITIAL_COLS = 80;
const INITIAL_ROWS = 24;

const vscode = useVsCodeApi();

const servers = ref<ServerListItem[]>([]);
const tabs = ref<TabsState>(emptyTabs());
/** false = 主页（服务器列表），true = 全屏终端。初始在主页面。 */
const showTerminal = ref(false);
/** null = 没在编辑；{ server } 有值 = 编辑某台；空对象 = 新建 */
const editing = ref<{ server?: ServerListItem } | null>(null);
const formErrors = ref<FieldErrors>({});
/** 表单上「测试连接」的状态：null = 还没测过 */
const testing = ref(false);
const testResult = ref<SshTestResult | null>(null);
const tabsRef = ref<InstanceType<typeof TerminalTabs> | null>(null);

const activeTab = computed(() =>
    tabs.value.tabs.find((tab) => tab.sessionId === tabs.value.activeId)
);

// sessionId 只要在这个 webview 内唯一即可，用一个自增计数就够，不必上 uuid
let sessionCounter = 0;

/** 一台服务器对应至多一个标签。主页卡片靠它显示状态点。 */
function tabOf(serverId: string) {
    return tabs.value.tabs.find((tab) => tab.serverId === serverId);
}

/** 主页卡片：服务器 + 它当前会话的状态点（没连过就没有）。 */
const serverCards = computed(() =>
    servers.value.map((server) => {
        const tab = tabOf(server.id);
        return { server, badge: tab ? statusBadge(tab) : undefined };
    })
);

function connect(server: ServerListItem): void {
    showTerminal.value = true;
    const existing = tabOf(server.id);
    if (existing) {
        // 已经连过（或正在连）：切过去，不重复开连接
        tabs.value = activateTab(tabs.value, existing.sessionId);
        return;
    }

    const sessionId = `s${++sessionCounter}`;
    tabs.value = addTab(tabs.value, {
        sessionId,
        serverId: server.id,
        title: server.name,
        hint: `${server.username}@${server.host}:${server.port}`,
        status: 'connecting'
    });
    vscode?.postMessage({
        command: MSG_SSH_CONNECT,
        sessionId,
        serverId: server.id,
        cols: INITIAL_COLS,
        rows: INITIAL_ROWS
    });
}

function closeSession(sessionId: string): void {
    vscode?.postMessage({ command: MSG_SSH_CLOSE, sessionId });
    // 本地先关掉，不等宿主回执——断线本来就不该有延迟感
    tabs.value = closeTab(tabs.value, sessionId);
    // 最后一个标签没了，回到服务器列表
    if (tabs.value.tabs.length === 0) {
        showTerminal.value = false;
    }
}

function saveServer(draft: ServerDraft): void {
    formErrors.value = {};
    vscode?.postMessage({ command: MSG_SSH_SAVE, draft });
}

function openEditor(server?: ServerListItem): void {
    formErrors.value = {};
    testing.value = false;
    testResult.value = null;
    editing.value = server ? { server } : {};
}

/** 表单上的「测试连接」：把当前内容（含还没保存的密码）交给宿主试连一次。 */
function testServer(draft: ServerDraft): void {
    testResult.value = null;
    testing.value = true;
    vscode?.postMessage({ command: MSG_SSH_TEST, draft });
}

/** 终端页的返回按钮：回主页，会话保持连接。 */
function goHome(): void {
    showTerminal.value = false;
}

// 终端页是 v-show 藏的，切回来时容器刚从 display:none 变回可见，
// xterm 不知道自己又变宽了，得重新量一遍并夺回焦点。
watch(showTerminal, async (visible) => {
    if (!visible) {
        return;
    }
    await nextTick();
    tabsRef.value?.fit();
});

function handleMessage(event: MessageEvent): void {
    const msg = event.data as HostToWebview | undefined;
    if (!msg) {
        return;
    }

    switch (msg.command) {
        case MSG_SSH_SERVERS: {
            servers.value = msg.servers;
            // 服务器被删掉后（宿主确认后推新列表），把它的标签也收掉
            const aliveIds = new Set(msg.servers.map((server) => server.id));
            tabs.value = closeTabsForMissingServers(tabs.value, aliveIds);
            if (tabs.value.tabs.length === 0) {
                showTerminal.value = false;
            }
            // 保存成功后宿主会推一份新列表过来，顺手把表单收掉
            editing.value = null;
            break;
        }

        case MSG_SSH_STATUS:
            tabs.value = setStatus(tabs.value, msg.sessionId, msg.status, msg.detail);
            break;

        case MSG_SSH_DATA:
            tabsRef.value?.write(msg.sessionId, msg.data);
            break;

        case MSG_SSH_FORM_ERROR:
            formErrors.value = msg.errors;
            break;

        case MSG_SSH_TEST_RESULT:
            testing.value = false;
            testResult.value = msg.ok ? { ok: true } : { ok: false, detail: msg.detail };
            break;
    }
}

onMounted(() => {
    window.addEventListener('message', handleMessage);
    vscode?.postMessage({ command: MSG_SSH_READY });
});

onBeforeUnmount(() => window.removeEventListener('message', handleMessage));
</script>

<template>
    <div class="layout">
        <main v-show="!showTerminal" class="home">
            <header class="home-header">
                <span class="heading">服务器</span>
                <div class="header-actions">
                    <button
                        v-if="tabs.tabs.length"
                        class="ghost-btn"
                        :title="`回到终端（${tabs.tabs.length} 个会话）`"
                        @click="showTerminal = true"
                    >
                        回到终端
                    </button>
                    <button class="add" @click="openEditor()">+ 新增服务器</button>
                </div>
            </header>

            <ul v-if="serverCards.length" class="server-list">
                <li
                    v-for="card in serverCards"
                    :key="card.server.id"
                    class="card"
                    @click="connect(card.server)"
                >
                    <span
                        v-if="card.badge"
                        class="dot"
                        :class="card.badge.className"
                        :title="card.badge.label"
                    />
                    <div class="info">
                        <div class="name">{{ card.server.name }}</div>
                        <div class="addr">
                            {{ card.server.username }}@{{ card.server.host }}:{{ card.server.port }}
                        </div>
                    </div>
                    <div class="ops">
                        <button title="编辑" @click.stop="openEditor(card.server)">&#9998;</button>
                        <button
                            title="删除"
                            class="danger"
                            @click.stop="
                                vscode?.postMessage({ command: MSG_SSH_DELETE, id: card.server.id })
                            "
                        >
                            &#128465;
                        </button>
                    </div>
                </li>
            </ul>

            <div v-else class="empty">
                <p>还没有服务器。</p>
                <button class="add" @click="openEditor()">+ 新增服务器</button>
            </div>
        </main>

        <div v-show="showTerminal" class="terminal-view">
            <div v-if="activeTab?.status === 'error'" class="banner">
                {{ activeTab.detail ?? '连接失败' }}
            </div>
            <TerminalTabs
                ref="tabsRef"
                :tabs="tabs.tabs"
                :active-id="tabs.activeId"
                @back="goHome"
                @input="(id, data) => vscode?.postMessage({ command: MSG_SSH_INPUT, sessionId: id, data })"
                @resize="(id, cols, rows) => vscode?.postMessage({ command: MSG_SSH_RESIZE, sessionId: id, cols, rows })"
                @select="(id) => (tabs = activateTab(tabs, id))"
                @close="closeSession"
            />
        </div>

        <ServerForm
            v-if="editing"
            :key="editing.server?.id ?? 'new'"
            :server="editing.server"
            :errors="formErrors"
            :testing="testing"
            :test-result="testResult"
            @save="saveServer"
            @cancel="editing = null"
            @test="testServer"
        />
    </div>
</template>

<style scoped>
.layout {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--vscode-editor-background, #1e1e1e);
    color: var(--vscode-editor-foreground, #ccc);
    font-family: var(--vscode-font-family, sans-serif);
    font-size: 13px;
}

/* ---------- 主页：全屏服务器列表 ---------- */

.home {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
}

.home-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: none;
    padding: 10px 20px;
    border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
}

.heading {
    font-size: 13px;
    font-weight: 600;
}

.header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}

.ghost-btn {
    padding: 4px 12px;
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 3px;
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #ccc);
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
}

.ghost-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground, #45494e);
}

.add {
    padding: 4px 12px;
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 3px;
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
}

.add:hover {
    background: var(--vscode-button-hoverBackground, #1177bb);
}

.server-list {
    flex: 1;
    margin: 24px auto;
    padding: 0 20px;
    width: 100%;
    max-width: 620px;
    box-sizing: border-box;
    overflow-y: auto;
    list-style: none;
}

.card {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    padding: 10px 14px;
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    border-radius: 5px;
    background: var(--vscode-editorWidget-background, #252526);
    cursor: pointer;
}

.card:hover {
    background: var(--vscode-list-hoverBackground, #2a2d2e);
    border-color: var(--vscode-focusBorder, #007fd4);
}

.dot {
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: 50%;
}

.dot.connecting {
    background: var(--vscode-charts-yellow, #e2c08d);
}

.dot.connected {
    background: var(--vscode-charts-green, #89d185);
}

.dot.error {
    background: var(--vscode-charts-red, #f14c4c);
}

.dot.closed {
    background: var(--vscode-disabledForeground, #666);
}

.info {
    flex: 1;
    min-width: 0;
}

.name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.addr {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--vscode-descriptionForeground, #999);
    font-size: 11px;
}

.ops {
    display: none;
    gap: 2px;
}

.card:hover .ops {
    display: flex;
}

.ops button {
    padding: 2px 5px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--vscode-descriptionForeground, #999);
    cursor: pointer;
    font-size: 13px;
}

.ops button:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
    color: var(--vscode-editor-foreground, #ccc);
}

.ops button.danger {
    color: var(--vscode-errorForeground, #f48771);
}

.ops button.danger:hover {
    background: rgba(240, 80, 80, 0.18);
    color: var(--vscode-errorForeground, #f48771);
}

.empty {
    margin: auto;
    text-align: center;
    color: var(--vscode-descriptionForeground, #999);
}

.empty p {
    margin: 0 0 14px;
    font-size: 13px;
}

/* ---------- 终端页 ---------- */

.terminal-view {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
}

.terminal-view > :deep(.wrap) {
    flex: 1;
    min-height: 0;
}

.banner {
    flex: none;
    padding: 6px 12px;
    background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
    border-bottom: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
    color: var(--vscode-editor-foreground, #ccc);
    font-size: 12px;
}
</style>

<!-- 页面级样式：html/body 不在组件根内，scoped 不会命中 -->
<style>
html,
body,
#app {
    height: 100%;
    margin: 0;
    padding: 0;
    overflow: hidden;
}
</style>
