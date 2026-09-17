<script setup lang="ts">
/**
 * 贪吃蛇：游戏流转（tick/循环/键盘/HUD/遮罩），由旧版 webviewContent.ts 的界面 IIFE 移植。
 * 引擎在 logic/engine.ts，Canvas 绘制在 BoardCanvas.vue。
 */
import { onMounted, reactive, ref } from 'vue';
import Cabinet from '../shared/Cabinet.vue';
import { MSG_GAME_OVER } from '../../shared/protocol';
import { useHighScoreSync, useVsCodeApi } from '../shared/vscode';
import BoardCanvas from './components/BoardCanvas.vue';
import { createState, intervalFor, queueDirection, step } from './logic/engine';
import type { SnakeState } from './logic/engine';

const MAX_FRAME_MS = 250; // 单帧时长上限，防止切回标签页时一次补走几十步

const vscode = useVsCodeApi();

const game: SnakeState = createState();
const best = ref(0);
const dead = ref(false);
const flash = ref<{ x: number; y: number; until: number } | null>(null);

/* ready | playing | paused | over */
const state = ref<'ready' | 'playing' | 'paused' | 'over'>('ready');

let acc = 0; // 累积的毫秒数，够了就前进一步
let lastTime = 0;

const hud = reactive({ score: 0, best: 0, level: 1, length: 4 });
const overlay = reactive({
    visible: true,
    title: 'S N A K E',
    text: '',
    hint: 'PRESS ENTER TO START'
});

const boardRef = ref<InstanceType<typeof BoardCanvas> | null>(null);

function showOverlay(title: string, text: string, hint: string): void {
    overlay.title = title;
    overlay.text = text;
    overlay.hint = hint;
    overlay.visible = true;
}

function hideOverlay(): void {
    overlay.visible = false;
}

function syncHud(): void {
    hud.score = game.score;
    hud.best = best.value;
    hud.level = game.level;
    hud.length = game.snake.length;
}

function start(): void {
    Object.assign(game, createState());
    dead.value = false;
    flash.value = null;
    acc = 0;
    lastTime = 0;
    state.value = 'playing';
    hideOverlay();
    syncHud();
}

function tick(): void {
    const result = step(game, Math.random);

    if (result === 'wall' || result === 'self') {
        dead.value = true;
        state.value = 'over';
        syncHud();
        showOverlay(
            'GAME OVER',
            `得分 ${game.score} · 长度 ${game.snake.length}`,
            'PRESS ENTER TO RESTART'
        );
        vscode?.postMessage({
            command: MSG_GAME_OVER,
            score: game.score,
            length: game.snake.length,
            level: game.level
        });
        return;
    }

    if (result === 'ate' || result === 'win') {
        const head = game.snake[0];
        flash.value = { x: head.x, y: head.y, until: performance.now() + 320 };
        if (game.score > best.value) {
            best.value = game.score;
        }
        syncHud();
    }

    if (result === 'win') {
        dead.value = true;
        state.value = 'over';
        showOverlay('PERFECT', `整盘吃满！得分 ${game.score}`, 'PRESS ENTER TO RESTART');
        vscode?.postMessage({
            command: MSG_GAME_OVER,
            win: true,
            score: game.score,
            length: game.snake.length,
            level: game.level
        });
    }
}

function loop(now: number): void {
    requestAnimationFrame(loop);

    const dt = lastTime ? now - lastTime : 0;
    lastTime = now;
    const clamped = Math.min(dt, MAX_FRAME_MS);

    if (state.value === 'playing') {
        acc += clamped;
        const interval = intervalFor(game.level);
        while (acc >= interval) {
            acc -= interval;
            tick();
            if (state.value !== 'playing') {
                acc = 0;
                break;
            }
        }
    }

    if (flash.value && performance.now() >= flash.value.until) {
        flash.value = null;
    }
    syncHud();
    boardRef.value?.draw();
}

/* ============ 键盘 ============ */
const DIRECTIONS: Record<string, [number, number]> = {
    arrowup: [0, -1],
    arrowdown: [0, 1],
    arrowleft: [-1, 0],
    arrowright: [1, 0],
    w: [0, -1],
    s: [0, 1],
    a: [-1, 0],
    d: [1, 0]
};

function togglePause(): void {
    if (state.value === 'playing') {
        state.value = 'paused';
        showOverlay('PAUSED', '', 'PRESS SPACE TO RESUME');
    } else if (state.value === 'paused') {
        state.value = 'playing';
        acc = 0;
        lastTime = 0;
        hideOverlay();
    }
}

function onKeydown(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();
    const dir = DIRECTIONS[key];
    let handled = true;

    if (dir) {
        if (state.value === 'playing') {
            queueDirection(game, dir[0], dir[1]);
        }
    } else if (key === 'enter') {
        if (state.value === 'ready' || state.value === 'over') {
            start();
        }
    } else if (key === ' ' || key === 'p') {
        if (state.value === 'playing' || state.value === 'paused') {
            togglePause();
        } else {
            start();
        }
    } else {
        handled = false;
    }

    /* 方向键和空格会让面板滚动，拦掉 */
    if (handled) {
        e.preventDefault();
    }
}

onMounted(() => {
    window.addEventListener('keydown', onKeydown);
    useHighScoreSync((value) => {
        best.value = value;
        syncHud();
    });
    syncHud();
    showOverlay('S N A K E', '', 'PRESS ENTER TO START');
    requestAnimationFrame(loop);
});
</script>

<template>
    <Cabinet
        title="SNAKE"
        subtitle="RETRO v1.0"
        :overlay-visible="overlay.visible"
        :overlay-title="overlay.title"
        :overlay-text="overlay.text"
        :overlay-hint="overlay.hint"
    >
        <template #board>
            <BoardCanvas ref="boardRef" :game="game" :dead="dead" :flash="flash" />
        </template>

        <template #sidebar>
            <div class="panel">
                <div class="panel-label">SCORE</div>
                <div class="panel-value">{{ hud.score }}</div>
            </div>

            <div class="panel">
                <div class="panel-label">BEST</div>
                <div class="panel-value small">{{ hud.best }}</div>
            </div>

            <div class="panel">
                <div class="panel-label">LEVEL</div>
                <div class="panel-value small">{{ hud.level }}</div>
            </div>

            <div class="panel">
                <div class="panel-label">LENGTH</div>
                <div class="panel-value small">{{ hud.length }}</div>
            </div>
        </template>

        <template #controls>
            <span><b>&#9650; &#9660; &#9664; &#9654;</b> 转向</span>
            <span><b>WASD</b> 转向</span>
            <span><b>SPACE</b> 暂停</span>
            <span><b>ENTER</b> 开始</span>
        </template>
    </Cabinet>
</template>
