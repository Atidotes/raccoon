<script setup lang="ts">
/**
 * 俄罗斯方块：主循环、键盘、HUD、遮罩，由旧版 webviewContent.ts 的界面 IIFE 移植。
 * 引擎在 logic/engine.ts，Canvas 绘制在 BoardCanvas/NextCanvas。
 */
import { onMounted, reactive, ref } from 'vue';
import Cabinet from '../shared/Cabinet.vue';
import { MSG_GAME_OVER } from '../../shared/protocol';
import { useHighScoreSync, useVsCodeApi } from '../shared/vscode';
import BoardCanvas from './components/BoardCanvas.vue';
import NextCanvas from './components/NextCanvas.vue';
import {
    createBoard,
    createGame,
    hardDrop,
    moveHorizontal,
    rotatePiece,
    softDrop,
    startGame as engineStartGame,
    tick
} from './logic/engine';
import type { TetrisGame } from './logic/engine';

const vscode = useVsCodeApi();

const game: TetrisGame = createGame();
const best = ref(0);

const hud = reactive({ score: 0, best: 0, level: 1, lines: 0 });
const overlay = reactive({
    visible: true,
    title: 'T E T R I S',
    text: '',
    hint: 'PRESS ENTER TO START'
});

const boardRef = ref<InstanceType<typeof BoardCanvas> | null>(null);
const nextRef = ref<InstanceType<typeof NextCanvas> | null>(null);

function showOverlay(title: string, text: string, hint: string): void {
    overlay.title = title;
    overlay.text = text || '';
    overlay.hint = hint || '';
    overlay.visible = true;
}

function hideOverlay(): void {
    overlay.visible = false;
}

function updateHUD(): void {
    hud.score = game.score;
    hud.best = best.value;
    hud.level = game.level;
    hud.lines = game.lines;
}

function startGame(): void {
    engineStartGame(game);
    hideOverlay();
    updateHUD();
}

function togglePause(): void {
    if (game.phase === 'playing') {
        game.phase = 'paused';
        showOverlay('PAUSED', '', 'PRESS P TO RESUME');
    } else if (game.phase === 'paused') {
        game.phase = 'playing';
        hideOverlay();
        game.lastTime = 0;
    }
}

function loop(time: number): void {
    requestAnimationFrame(loop);

    if (!game.lastTime) {
        game.lastTime = time;
    }

    const delta = time - game.lastTime;
    game.lastTime = time;

    tick(game, delta);

    updateHUD();
    boardRef.value?.draw();
    nextRef.value?.draw();
}

function onKeydown(e: KeyboardEvent): void {
    const k = e.key;

    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' ||
        k === 'ArrowDown' || k === ' ' || k === 'Spacebar') {
        e.preventDefault();
    }

    if (game.phase === 'ready' || game.phase === 'over') {
        if (k === 'Enter' || k === ' ') {
            startGame();
        }
        return;
    }

    if (k === 'p' || k === 'P' || k === 'Escape') {
        togglePause();
        return;
    }

    if (game.phase !== 'playing') {
        return;
    }

    switch (k) {
        case 'ArrowLeft':
        case 'a':
        case 'A':
            moveHorizontal(game, -1);
            break;

        case 'ArrowRight':
        case 'd':
        case 'D':
            moveHorizontal(game, 1);
            break;

        case 'ArrowDown':
        case 's':
        case 'S':
            softDrop(game);
            break;

        case 'ArrowUp':
        case 'w':
        case 'W':
        case 'x':
        case 'X':
            rotatePiece(game, 1);
            break;

        case 'z':
        case 'Z':
            rotatePiece(game, -1);
            break;

        case ' ':
        case 'Spacebar':
            hardDrop(game);
            break;

        default:
            break;
    }
}

onMounted(() => {
    game.board = createBoard();
    game.phase = 'ready';
    showOverlay('T E T R I S', '', 'PRESS ENTER TO START');
    updateHUD();
    boardRef.value?.draw();
    nextRef.value?.draw();

    // 游戏结束：遮罩 + best 判断 + 上报宿主（与旧版顺序一致）
    game.onGameOver = (score, lines) => {
        showOverlay('GAME OVER', 'SCORE ' + score, 'PRESS ENTER TO PLAY AGAIN');
        if (score > best.value) {
            best.value = score;
            updateHUD();
        }
        vscode?.postMessage({ command: MSG_GAME_OVER, score, lines });
    };

    useHighScoreSync((value) => {
        best.value = value;
        updateHUD();
    });

    window.addEventListener('keydown', onKeydown);
    requestAnimationFrame(loop);

    window.focus();
    if (document.body) {
        document.body.focus();
    }
});
</script>

<template>
    <Cabinet
        title="TETRIS"
        subtitle="RETRO v1.0"
        :overlay-visible="overlay.visible"
        :overlay-title="overlay.title"
        :overlay-text="overlay.text"
        :overlay-hint="overlay.hint"
    >
        <template #board>
            <BoardCanvas ref="boardRef" :game="game" />
        </template>

        <template #sidebar>
            <div class="panel">
                <div class="panel-label">NEXT</div>
                <NextCanvas ref="nextRef" :game="game" />
            </div>

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
                <div class="panel-label">LINES</div>
                <div class="panel-value small">{{ hud.lines }}</div>
            </div>
        </template>

        <template #controls>
            <span><b>&#9664; &#9654;</b> 移动</span>
            <span><b>&#9650;</b> 旋转</span>
            <span><b>&#9660;</b> 软降</span>
            <span><b>SPACE</b> 硬降</span>
            <span><b>P</b> 暂停</span>
            <span><b>ENTER</b> 开始</span>
        </template>
    </Cabinet>
</template>
