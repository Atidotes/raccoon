<script setup lang="ts">
/**
 * 终端标签区。
 *
 * 每个标签一个 xterm 实例，全部挂在 DOM 里，非活动的用 display:none 藏起来——
 * 卸载再重建会把回滚缓冲一起丢掉，切回去就只剩一张白屏。
 *
 * xterm 是命令式组件，没法用 v-model 描述，所以这里自己维护
 * sessionId → TerminalHandle 的映射，按标签集合的增删来建/拆。
 */
import { nextTick, onBeforeUnmount, watch } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import type { TermTab } from '../logic/sessions';
import { statusBadge } from '../logic/sessions';
import { createTerminal } from '../xterm';
import type { TerminalHandle } from '../xterm';

const props = defineProps<{
    tabs: TermTab[];
    activeId?: string;
}>();

const emit = defineEmits<{
    input: [sessionId: string, data: string];
    resize: [sessionId: string, cols: number, rows: number];
    select: [sessionId: string];
    close: [sessionId: string];
    back: [];
}>();

const containers = new Map<string, HTMLElement>();
const handles = new Map<string, TerminalHandle>();

function registerContainer(sessionId: string, el: Element | ComponentPublicInstance | null): void {
    // 组件卸载时 Vue 会回调一次 null，正好用来清掉引用
    if (el instanceof HTMLElement) {
        containers.set(sessionId, el);
    } else {
        containers.delete(sessionId);
    }
}

function syncTerminals(): void {
    const alive = new Set(props.tabs.map((tab) => tab.sessionId));

    for (const [sessionId, handle] of handles) {
        if (!alive.has(sessionId)) {
            handle.dispose();
            handles.delete(sessionId);
        }
    }

    for (const tab of props.tabs) {
        if (handles.has(tab.sessionId)) {
            continue;
        }
        const container = containers.get(tab.sessionId);
        if (!container) {
            continue;
        }
        handles.set(
            tab.sessionId,
            createTerminal(container, {
                onData: (data) => emit('input', tab.sessionId, data),
                onResize: (cols, rows) => emit('resize', tab.sessionId, cols, rows)
            })
        );
    }
}

// 标签集合变了就同步实例。join 成一个字符串是为了让 watch 有个稳定的比较值，
// 否则每次 setStatus 生成新数组都会触发一遍。
watch(
    () => props.tabs.map((tab) => tab.sessionId).join('\n'),
    async () => {
        await nextTick();
        syncTerminals();
    },
    { immediate: true }
);

// 切回一个标签时容器刚从 display:none 变回来，xterm 还不知道自己变宽了，得重新量。
watch(
    () => props.activeId,
    async (sessionId) => {
        await nextTick();
        const handle = sessionId ? handles.get(sessionId) : undefined;
        handle?.fit();
        handle?.focus();
    }
);

onBeforeUnmount(() => {
    for (const handle of handles.values()) {
        handle.dispose();
    }
    handles.clear();
    containers.clear();
});

/** 把远端输出写进对应终端。App.vue 收到 ssh:data 时调用。 */
function write(sessionId: string, data: string): void {
    handles.get(sessionId)?.write(data);
}

/**
 * 重新量当前活动终端并夺回焦点。App.vue 在整页从 display:none 切回来时调用——
 * 那时容器刚恢复可见，xterm 的 ResizeObserver 不一定感知到尺寸变化。
 */
function fit(): void {
    const handle = props.activeId ? handles.get(props.activeId) : undefined;
    handle?.fit();
    handle?.focus();
}

defineExpose({ write, fit });
</script>

<template>
    <div class="wrap">
        <div class="tab-bar">
            <button class="back" title="返回服务器列表（连接保持）" @click="emit('back')">
                &#8592;
            </button>
            <button
                v-for="tab in tabs"
                :key="tab.sessionId"
                class="tab"
                :class="{ active: tab.sessionId === activeId }"
                :title="tab.hint"
                @click="emit('select', tab.sessionId)"
            >
                <span
                    class="dot"
                    :class="statusBadge(tab).className"
                    :title="statusBadge(tab).label"
                />
                <span class="title">{{ tab.title }}</span>
                <span class="close" title="断开并关闭" @click.stop="emit('close', tab.sessionId)">
                    &#215;
                </span>
            </button>
        </div>

        <div class="panes">
            <div
                v-for="tab in tabs"
                :key="tab.sessionId"
                :ref="(el) => registerContainer(tab.sessionId, el)"
                class="pane"
                :class="{ hidden: tab.sessionId !== activeId }"
            />
        </div>
    </div>
</template>

<style scoped>
.wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
}

.tab-bar {
    display: flex;
    flex: none;
    gap: 2px;
    padding: 4px 6px 0;
    overflow-x: auto;
    background: var(--vscode-editorGroupHeader-tabsBackground, #252526);
}

.tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border: 0;
    border-bottom: 1px solid transparent;
    background: transparent;
    color: var(--vscode-tab-inactiveForeground, #969696);
    cursor: pointer;
    font-family: var(--vscode-font-family, sans-serif);
    font-size: 12px;
    white-space: nowrap;
}

.back {
    flex: none;
    padding: 5px 10px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--vscode-tab-inactiveForeground, #969696);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
}

.back:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
    color: var(--vscode-editor-foreground, #ccc);
}

.tab.active {
    background: var(--vscode-tab-activeBackground, #1e1e1e);
    color: var(--vscode-tab-activeForeground, #fff);
    border-bottom-color: var(--vscode-focusBorder, #007fd4);
}

.dot {
    width: 7px;
    height: 7px;
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

.title {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
}

.close {
    padding: 0 2px;
    border-radius: 3px;
    font-size: 14px;
    line-height: 1;
}

.close:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
}

.panes {
    position: relative;
    flex: 1;
    min-height: 0;
}

.pane {
    position: absolute;
    inset: 0;
    padding: 4px 0 0 8px;
}

/* 藏起来的终端不占位；xterm 的 fit 也会跳过零尺寸容器 */
.pane.hidden {
    display: none;
}
</style>
