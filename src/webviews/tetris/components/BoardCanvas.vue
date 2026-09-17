<script setup lang="ts">
/**
 * 俄罗斯方块主棋盘 Canvas：绘制函数从旧版 webviewContent.ts 逐行直译。
 * 主循环在 App.vue，每帧调 draw()。
 */
import { onMounted, ref } from 'vue';
import {
    BOARD_H,
    BOARD_W,
    CELL,
    COLS,
    COLORS,
    ROWS,
    collides
} from '../logic/engine';
import type { TetrisGame } from '../logic/engine';

const props = defineProps<{
    game: TetrisGame;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
let ctx: CanvasRenderingContext2D | null = null;

function drawBlock(context: CanvasRenderingContext2D, px: number, py: number, size: number, color: string) {
    const s = size - 2;
    const x = px + 1;
    const y = py + 1;

    context.fillStyle = color;
    context.fillRect(x, y, s, s);

    context.fillStyle = 'rgba(255, 255, 255, 0.32)';
    context.fillRect(x, y, s, 3);
    context.fillRect(x, y, 3, s);

    context.fillStyle = 'rgba(0, 0, 0, 0.35)';
    context.fillRect(x, y + s - 3, s, 3);
    context.fillRect(x + s - 3, y, 3, s);
}

function drawGrid() {
    if (!ctx) {
        return;
    }
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let c = 1; c < COLS; c++) {
        const x = c * CELL + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, BOARD_H);
    }
    for (let r = 1; r < ROWS; r++) {
        const y = r * CELL + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(BOARD_W, y);
    }

    ctx.stroke();
}

function drawStack() {
    if (!ctx) {
        return;
    }
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const t = props.game.board[r][c];
            if (t) {
                drawBlock(ctx, c * CELL, r * CELL, CELL, COLORS[t]);
            }
        }
    }
}

function drawGhost() {
    if (!ctx) {
        return;
    }
    const current = props.game.current;
    if (!current) {
        return;
    }

    const ghost = {
        type: current.type,
        matrix: current.matrix,
        x: current.x,
        y: current.y
    };

    while (!collides(ghost, props.game.board)) {
        ghost.y++;
    }
    ghost.y--;

    if (ghost.y <= current.y) {
        return;
    }

    const m = ghost.matrix;
    ctx.strokeStyle = 'rgba(134, 239, 172, 0.30)';
    ctx.lineWidth = 2;

    for (let r = 0; r < m.length; r++) {
        for (let c = 0; c < m[r].length; c++) {
            if (!m[r][c]) {
                continue;
            }

            const py = ghost.y + r;
            if (py < 0) {
                continue;
            }

            const px = ghost.x + c;
            ctx.strokeRect(px * CELL + 4, py * CELL + 4, CELL - 8, CELL - 8);
        }
    }
}

function drawCurrent() {
    if (!ctx) {
        return;
    }
    const current = props.game.current;
    if (!current) {
        return;
    }

    const m = current.matrix;
    for (let r = 0; r < m.length; r++) {
        for (let c = 0; c < m[r].length; c++) {
            if (!m[r][c]) {
                continue;
            }

            const y = current.y + r;
            if (y < 0) {
                continue;
            }

            drawBlock(ctx, (current.x + c) * CELL, y * CELL, CELL, COLORS[current.type]);
        }
    }
}

function render() {
    if (!ctx) {
        return;
    }
    ctx.fillStyle = '#060a07';
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);

    drawGrid();
    drawStack();

    if (props.game.phase === 'playing' || props.game.phase === 'paused') {
        drawGhost();
        drawCurrent();
    }
}

onMounted(() => {
    ctx = canvasRef.value?.getContext('2d') ?? null;
    render();
});

defineExpose({ draw: render });
</script>

<template>
    <canvas id="board" ref="canvasRef" width="260" height="520"></canvas>
</template>
