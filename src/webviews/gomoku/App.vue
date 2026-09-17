<script setup lang="ts">
/**
 * 五子棋：回合流转（人执黑先行，AI 执白），由旧版 webviewContent.ts 的界面 IIFE 移植。
 * 与旧版一样，游戏状态全在网页里，与宿主没有消息往来。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import GomokuBoard from './components/GomokuBoard.vue';
import {
    BLACK,
    EMPTY,
    WHITE,
    checkWin,
    candidateCells,
    createBoard,
    findBestMove
} from './logic/engine';
import type { Board, Difficulty, Point } from './logic/engine';

interface Stone extends Point {
    color: number;
}

const AI_DELAY_MS = 400; // AI「思考」的停顿，让落子有节奏感

const boardRef = ref<InstanceType<typeof GomokuBoard> | null>(null);

const board = ref<Board>(createBoard());
const history = ref<Stone[]>([]);          /* {x, y, color}，从先手到后手 */
const humanTurn = ref(true);               /* 人执黑先行 */
const gameOver = ref(false);
const winLine = ref<Point[] | null>(null); /* 胜利五子的坐标，用于高亮 */
const difficulty = ref<Difficulty>('medium');

const statusText = ref('轮到你（黑棋）');
const dotClass = ref('black');             /* black | white | gray */

let pendingAi: ReturnType<typeof setTimeout> | null = null;

function setStatus(text: string, dot: string): void {
    statusText.value = text;
    dotClass.value = dot;
}

function humanPlace(x: number, y: number): void {
    board.value[y][x] = BLACK;
    history.value.push({ x, y, color: BLACK });
    boardRef.value?.draw();

    const line = checkWin(board.value, x, y, BLACK);
    if (line) {
        endGame('你赢了！🎉', 'black', line);
        return;
    }
    if (!candidateCells(board.value).length) {
        endGame('平局', 'gray', null);
        return;
    }
    humanTurn.value = false;
    setStatus('AI 思考中…', 'white');
    pendingAi = setTimeout(aiMove, AI_DELAY_MS);
}

function aiMove(): void {
    pendingAi = null;
    const move = findBestMove(board.value, WHITE, BLACK, difficulty.value);
    if (!move) {
        endGame('平局', 'gray', null);
        return;
    }
    board.value[move.y][move.x] = WHITE;
    history.value.push({ x: move.x, y: move.y, color: WHITE });
    boardRef.value?.draw();

    const line = checkWin(board.value, move.x, move.y, WHITE);
    if (line) {
        endGame('AI 赢了', 'white', line);
        return;
    }
    if (!candidateCells(board.value).length) {
        endGame('平局', 'gray', null);
        return;
    }
    humanTurn.value = true;
    setStatus('轮到你（黑棋）', 'black');
}

function endGame(text: string, dot: string, line: Point[] | null): void {
    gameOver.value = true;
    winLine.value = line;
    setStatus(text, dot);
    boardRef.value?.draw();
}

function undo(): void {
    if (pendingAi || !history.value.length) {
        return;
    }
    /* 撤到「轮到你」为止：最后一步是 AI 的白子就撤两步（连你的黑子一起），否则撤一步 */
    const lastColor = history.value[history.value.length - 1].color;
    const steps = Math.min(lastColor === WHITE ? 2 : 1, history.value.length);
    for (let i = 0; i < steps; i++) {
        const m = history.value.pop()!;
        board.value[m.y][m.x] = EMPTY;
    }
    gameOver.value = false;
    winLine.value = null;
    humanTurn.value = true;
    setStatus('轮到你（黑棋）', 'black');
    boardRef.value?.draw();
}

function restart(): void {
    if (pendingAi) {
        clearTimeout(pendingAi);
        pendingAi = null;
    }
    board.value = createBoard();
    history.value = [];
    gameOver.value = false;
    winLine.value = null;
    humanTurn.value = true;
    setStatus('轮到你（黑棋）', 'black');
    boardRef.value?.draw();
}

function handlePlace(cell: Point | null): void {
    if (!cell || !humanTurn.value || gameOver.value) {
        return;
    }
    if (board.value[cell.y][cell.x] !== EMPTY) {
        return;
    }
    humanPlace(cell.x, cell.y);
}

onMounted(() => {
    window.addEventListener('keydown', (e) => {
        const tag = (e.target as HTMLElement).tagName;
        if (e.key === 'Enter' && tag !== 'BUTTON' && tag !== 'SELECT') {
            restart();
        } else if ((e.key === 'z' || e.key === 'Z') && !e.ctrlKey && !e.metaKey) {
            undo();
        }
    });
    setStatus('轮到你（黑棋）', 'black');
    boardRef.value?.draw();
});

onBeforeUnmount(() => {
    // 旧版没清这个定时器（面板销毁即整个页面销毁，其实无妨），这里补上更干净
    if (pendingAi) {
        clearTimeout(pendingAi);
    }
});
</script>

<template>
    <div class="wrap">
        <h1>五 子 棋</h1>
        <div class="bar">
            <div class="status">
                <span class="turn-dot" :class="dotClass"></span>
                <span>{{ statusText }}</span>
            </div>
            <div class="controls">
                <select v-model="difficulty" title="难度">
                    <option value="easy">简单</option>
                    <option value="medium" selected>中等</option>
                    <option value="hard">困难</option>
                </select>
                <button title="悔棋（Z）" @click="undo">悔棋</button>
                <button title="重新开始（Enter）" @click="restart">重新开始</button>
            </div>
        </div>
        <GomokuBoard ref="boardRef" :history="history" :win-line="winLine" :human-turn="humanTurn"
            :game-over="gameOver" @place="handlePlace" />
        <p class="hint">点击交叉点落子 · Enter 重新开始 · Z 悔棋</p>
    </div>
</template>

<style>
  /* 页面级样式（html/body 不在组件根内） */
  * { box-sizing: border-box; }

  body {
    margin: 0;
    padding: 18px 0 24px;
    background: #1e1e1e;
    color: #d4d4d4;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    display: flex;
    justify-content: center;
  }
</style>

<style scoped>
  .wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 10px;
    color: #e8e8e8;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 528px;
  }

  .status {
    flex: 1;
    font-size: 14px;
    color: #cccccc;
  }

  .turn-dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    margin-right: 8px;
    vertical-align: -1px;
  }

  .turn-dot.black { background: #141414; box-shadow: 0 0 0 1px #8a8a8a; }
  .turn-dot.white { background: #e6e6e6; }
  .turn-dot.gray { background: #6b6b6b; }

  .controls {
    display: flex;
    gap: 8px;
  }

  select, button {
    background: #2d2d2d;
    color: #cccccc;
    border: 1px solid #454545;
    border-radius: 4px;
    padding: 4px 12px;
    font-size: 13px;
    cursor: pointer;
  }

  select:hover, button:hover { background: #3a3a3a; }
  button:active { background: #404040; }

  canvas {
    border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
    cursor: pointer;
  }

  .hint {
    margin: 0;
    font-size: 12px;
    color: #8a8a8a;
  }
</style>
