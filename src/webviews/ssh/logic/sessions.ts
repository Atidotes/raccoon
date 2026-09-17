/**
 * 终端标签页的状态机。
 *
 * 抽成纯函数是因为标签的增删切换（尤其是「关掉当前标签后该激活谁」）
 * 光靠肉眼在组件里验很容易漏边界，这里能直接单测。
 * 组件只负责把返回的新状态画出来。
 */
import type { SessionStatus } from '../../../shared/protocol';

export interface TermTab {
    sessionId: string;
    serverId: string;
    /** 标签上显示的名字，取服务器名 */
    title: string;
    /** 悬停提示，形如 deploy@10.0.0.1:22 */
    hint: string;
    status: SessionStatus;
    /** status === 'error' 时的说明文字 */
    detail?: string;
}

export interface TabsState {
    tabs: TermTab[];
    /** 当前激活的标签；没有标签时为 undefined */
    activeId?: string;
}

export const emptyTabs = (): TabsState => ({ tabs: [], activeId: undefined });

/** 新标签追加到末尾并激活。同一个 sessionId 重复添加时直接返回原状态。 */
export function addTab(state: TabsState, tab: TermTab): TabsState {
    if (state.tabs.some((item) => item.sessionId === tab.sessionId)) {
        return state;
    }
    return { tabs: [...state.tabs, tab], activeId: tab.sessionId };
}

export function activateTab(state: TabsState, sessionId: string): TabsState {
    if (state.activeId === sessionId || !state.tabs.some((tab) => tab.sessionId === sessionId)) {
        return state;
    }
    return { ...state, activeId: sessionId };
}

/**
 * 关标签。关掉的不是当前标签时，激活项不变；
 * 是当前标签时，接管它左边那个，没有左边就选右边第一个（也就是关掉后同位置的那个）。
 */
export function closeTab(state: TabsState, sessionId: string): TabsState {
    const index = state.tabs.findIndex((tab) => tab.sessionId === sessionId);
    if (index === -1) {
        return state;
    }

    const tabs = state.tabs.filter((tab) => tab.sessionId !== sessionId);
    if (state.activeId !== sessionId) {
        return { tabs, activeId: state.activeId };
    }

    return { tabs, activeId: (tabs[index - 1] ?? tabs[index])?.sessionId };
}

/**
 * 收掉「服务器记录已经不存在」的标签。删除服务器时宿主会先断开它的会话、再推
 * 一份新列表过来，网页侧拿这个对齐，免得列表里没了、标签上还留着一个死会话。
 *
 * 遍历的是传进来的那份 tabs，每次 closeTab 都从它派生新状态，所以一次收掉多个
 * 也不会漏——包括它们中间夹着当前活动标签的情况。
 */
export function closeTabsForMissingServers(
    state: TabsState,
    aliveServerIds: ReadonlySet<string>
): TabsState {
    let next = state;
    for (const tab of state.tabs) {
        if (!aliveServerIds.has(tab.serverId)) {
            next = closeTab(next, tab.sessionId);
        }
    }
    return next;
}

export function setStatus(
    state: TabsState,
    sessionId: string,
    status: SessionStatus,
    detail?: string
): TabsState {
    return {
        ...state,
        tabs: state.tabs.map((tab) =>
            tab.sessionId === sessionId ? { ...tab, status, detail } : tab
        )
    };
}

/** 标签右侧的状态点：颜色 + 悬停说明。 */
export function statusBadge(tab: TermTab): { className: string; label: string } {
    switch (tab.status) {
        case 'connecting':
            return { className: 'connecting', label: '连接中…' };
        case 'connected':
            return { className: 'connected', label: '已连接' };
        case 'error':
            return { className: 'error', label: tab.detail ?? '连接失败' };
        default:
            return { className: 'closed', label: '已断开' };
    }
}
