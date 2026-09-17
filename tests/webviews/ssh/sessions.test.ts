/**
 * SSH 终端标签状态机测试。
 * 重点在关标签时「接下来激活谁」——这块光看代码容易漏边界。
 */
import { describe, expect, it } from 'vitest';
import {
    activateTab,
    addTab,
    closeTab,
    closeTabsForMissingServers,
    emptyTabs,
    setStatus,
    statusBadge
} from '../../../src/webviews/ssh/logic/sessions';
import type { TermTab, TabsState } from '../../../src/webviews/ssh/logic/sessions';

const tab = (sessionId: string, patch: Partial<TermTab> = {}): TermTab => ({
    sessionId,
    serverId: `server-${sessionId}`,
    title: sessionId.toUpperCase(),
    hint: `root@10.0.0.1:22`,
    status: 'connecting',
    ...patch
});

/** 建一个 a|b|c 且激活 b 的状态 */
const threeTabs = (): TabsState =>
    activateTab(addTab(addTab(addTab(emptyTabs(), tab('a')), tab('b')), tab('c')), 'b');

describe('addTab', () => {
    it('追加到末尾并激活新标签', () => {
        const state = addTab(addTab(emptyTabs(), tab('a')), tab('b'));

        expect(state.tabs.map((item) => item.sessionId)).toEqual(['a', 'b']);
        expect(state.activeId).toBe('b');
    });

    it('sessionId 重复时原样返回', () => {
        const first = addTab(emptyTabs(), tab('a'));
        const second = addTab(first, tab('a', { title: '别的' }));

        expect(second).toBe(first);
        expect(second.tabs[0].title).toBe('A');
    });
});

describe('activateTab', () => {
    it('切到已有标签', () => {
        expect(activateTab(threeTabs(), 'c').activeId).toBe('c');
    });

    it('未知 sessionId 不改变状态', () => {
        const state = threeTabs();
        expect(activateTab(state, 'zzz')).toBe(state);
    });

    it('切到当前标签时原样返回', () => {
        const state = threeTabs();
        expect(activateTab(state, 'b')).toBe(state);
    });
});

describe('closeTab', () => {
    it('关掉非当前标签时激活项不变', () => {
        const state = closeTab(threeTabs(), 'a');

        expect(state.tabs.map((item) => item.sessionId)).toEqual(['b', 'c']);
        expect(state.activeId).toBe('b');
    });

    it('关掉当前标签时接管左边那个', () => {
        // 激活 b，关掉 b → 接管左边的 a
        const state = closeTab(threeTabs(), 'b');

        expect(state.tabs.map((item) => item.sessionId)).toEqual(['a', 'c']);
        expect(state.activeId).toBe('a');
    });

    it('关掉最左边且是当前标签时接管右边第一个', () => {
        const state = closeTab(activateTab(threeTabs(), 'a'), 'a');

        expect(state.activeId).toBe('b');
    });

    it('关掉最后一个标签后没有激活项', () => {
        const state = closeTab(addTab(emptyTabs(), tab('only')), 'only');

        expect(state.tabs).toEqual([]);
        expect(state.activeId).toBeUndefined();
    });

    it('未知 sessionId 不改变状态', () => {
        const state = threeTabs();
        expect(closeTab(state, 'zzz')).toBe(state);
    });
});

describe('closeTabsForMissingServers', () => {
    /** a|b|c|d 四台服务器各一个标签，激活 b */
    const fourServers = (): TabsState =>
        activateTab(
            addTab(
                addTab(
                    addTab(
                        addTab(emptyTabs(), tab('a', { serverId: 'srv-a' })),
                        tab('b', { serverId: 'srv-b' })
                    ),
                    tab('c', { serverId: 'srv-c' })
                ),
                tab('d', { serverId: 'srv-d' })
            ),
            'b'
        );

    const alive = (...ids: string[]): Set<string> => new Set(ids);

    it('服务器都还在时原样返回', () => {
        const state = fourServers();
        const next = closeTabsForMissingServers(state, alive('srv-a', 'srv-b', 'srv-c', 'srv-d'));

        // 要的是同一个引用：没变化就不该让 Vue 重新渲染一遍
        expect(next).toBe(state);
    });

    it('收掉非活动标签，激活项不变', () => {
        const next = closeTabsForMissingServers(fourServers(), alive('srv-a', 'srv-b', 'srv-d'));

        expect(next.tabs.map((item) => item.sessionId)).toEqual(['a', 'b', 'd']);
        expect(next.activeId).toBe('b');
    });

    it('收掉当前活动标签时接管左边那个', () => {
        const next = closeTabsForMissingServers(fourServers(), alive('srv-a', 'srv-c', 'srv-d'));

        expect(next.tabs.map((item) => item.sessionId)).toEqual(['a', 'c', 'd']);
        expect(next.activeId).toBe('a');
    });

    it('一次收掉多个（含活动标签）也不漏', () => {
        // b 是活动的、c 是普通标签，一起删 → 收完后接管 a
        const next = closeTabsForMissingServers(fourServers(), alive('srv-a', 'srv-d'));

        expect(next.tabs.map((item) => item.sessionId)).toEqual(['a', 'd']);
        expect(next.activeId).toBe('a');
    });

    it('服务器全被删掉后没有标签也没有激活项', () => {
        const next = closeTabsForMissingServers(fourServers(), alive());

        expect(next.tabs).toEqual([]);
        expect(next.activeId).toBeUndefined();
    });

    it('本来就没有标签时返回原状态', () => {
        const state = emptyTabs();
        expect(closeTabsForMissingServers(state, alive())).toBe(state);
    });
});

describe('setStatus', () => {
    it('只更新命中的标签', () => {
        const state = setStatus(threeTabs(), 'b', 'error', '连接被拒绝');

        expect(state.tabs.find((item) => item.sessionId === 'b')).toMatchObject({
            status: 'error',
            detail: '连接被拒绝'
        });
        expect(state.tabs.find((item) => item.sessionId === 'a')?.status).toBe('connecting');
        expect(state.activeId).toBe('b');
    });

    it('未知 sessionId 时标签内容不变', () => {
        expect(setStatus(threeTabs(), 'zzz', 'connected').tabs).toEqual(threeTabs().tabs);
    });
});

describe('statusBadge', () => {
    it('各状态映射到对应样式与说明', () => {
        expect(statusBadge(tab('a', { status: 'connecting' })).className).toBe('connecting');
        expect(statusBadge(tab('a', { status: 'connected' })).className).toBe('connected');
        expect(statusBadge(tab('a', { status: 'closed' })).label).toBe('已断开');
    });

    it('error 时优先展示宿主给的说明', () => {
        const badge = statusBadge(tab('a', { status: 'error', detail: '认证失败' }));

        expect(badge.className).toBe('error');
        expect(badge.label).toBe('认证失败');
    });

    it('error 但没带说明时退回默认文案', () => {
        expect(statusBadge(tab('a', { status: 'error' })).label).toBe('连接失败');
    });
});
