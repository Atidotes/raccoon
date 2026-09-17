<script setup lang="ts">
/**
 * 贪吃蛇棋盘 Canvas：绘制函数从旧版 webviewContent.ts 逐行直译。
 * rAF 循环在 App.vue，每帧调 draw()；本组件只负责画。
 */
import { onMounted, ref } from 'vue';
import { COLS, ROWS } from '../logic/engine';
import type { SnakeState } from '../logic/engine';

interface Flash {
    x: number;
    y: number;
    until: number;
}

const props = defineProps<{
    game: SnakeState;
    dead: boolean;
    flash: Flash | null;
}>();

const CELL = 22;
const BOARD_W = COLS * CELL; // 24 * 22 = 528
const BOARD_H = ROWS * CELL; // 20 * 22 = 440
const FLASH_MS = 320;        // 吃到食物时那圈涟漪的时长

const canvasRef = ref<HTMLCanvasElement | null>(null);
let ctx: CanvasRenderingContext2D | null = null;

function resize() {
    if (!canvasRef.value) {
        return;
    }
    const dpr = window.devicePixelRatio || 1;
    canvasRef.value.width = BOARD_W * dpr;
    canvasRef.value.height = BOARD_H * dpr;
    canvasRef.value.style.width = BOARD_W + 'px';
    canvasRef.value.style.height = BOARD_H + 'px';
    ctx = canvasRef.value.getContext('2d');
    if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
}

function roundRect(x: number, y: number, w: number, h: number, r: number) {
    if (!ctx) {
        return;
    }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/* 蛇身自头至尾分四档亮度，越靠尾巴越暗 */
function bodyColor(shade: number): string {
    if (props.dead) {
        return '#33604a';
    }
    if (shade < 0.1) {
        return '#86efac';
    }
    if (shade < 0.45) {
        return '#4ade80';
    }
    if (shade < 0.75) {
        return '#22c55e';
    }
    return '#16a34a';
}

function drawGrid() {
    if (!ctx) {
        return;
    }
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.055)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
        const px = x * CELL;
        ctx.beginPath();
        ctx.moveTo(px + 0.5, 0);
        ctx.lineTo(px + 0.5, BOARD_H);
        ctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
        const py = y * CELL;
        ctx.beginPath();
        ctx.moveTo(0, py + 0.5);
        ctx.lineTo(BOARD_W, py + 0.5);
        ctx.stroke();
    }
}

function drawFood() {
    if (!ctx || !props.game.food) {
        return;
    }
    const t = performance.now() / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(t * 5);
    const cx = (props.game.food.x + 0.5) * CELL;
    const cy = (props.game.food.y + 0.5) * CELL;
    const r = CELL * (0.24 + 0.06 * pulse);

    ctx.save();
    ctx.shadowColor = 'rgba(248, 113, 113, 0.95)';
    ctx.shadowBlur = 10 + 9 * pulse;
    const fg = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
    fg.addColorStop(0, '#fecaca');
    fg.addColorStop(1, '#dc2626');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawSnake() {
    if (!ctx) {
        return;
    }
    const n = props.game.snake.length;

    /* 蛇身按整格铺满、首尾相接，看起来是一整条而不是一串方块。
       辉光先整体填充一次：一次 fill 的阴影按整条蛇的轮廓算，
       否则一格一次填充，接缝处的阴影会互相叠加、糊成一团。 */
    const body = new Path2D();
    for (let i = 1; i < n; i++) {
        body.rect(props.game.snake[i].x * CELL, props.game.snake[i].y * CELL, CELL, CELL);
    }
    ctx.save();
    if (!props.dead) {
        ctx.shadowColor = 'rgba(74, 222, 128, 0.55)';
        ctx.shadowBlur = 10;
    }
    ctx.fillStyle = props.dead ? '#33604a' : '#22c55e';
    ctx.fill(body);
    ctx.restore();

    /* 再按从尾到头的深浅盖一遍（此时不带阴影） */
    for (let i = n - 1; i >= 1; i--) {
        const s = props.game.snake[i];
        const shade = n === 1 ? 0 : i / (n - 1);
        ctx.fillStyle = bodyColor(shade);
        ctx.fillRect(s.x * CELL, s.y * CELL, CELL, CELL);
    }

    if (n) {
        drawHead(props.game.snake[0]);
    }
}

/* 蛇头：比身体亮一档，略微内缩并带圆角，和身体区分开 */
function drawHead(head: { x: number; y: number }) {
    if (!ctx) {
        return;
    }
    const pad = 0.75;
    const x = head.x * CELL + pad;
    const y = head.y * CELL + pad;
    const w = CELL - pad * 2;

    ctx.save();
    if (!props.dead) {
        ctx.shadowColor = 'rgba(74, 222, 128, 0.9)';
        ctx.shadowBlur = 13;
    }
    ctx.fillStyle = props.dead ? '#4b6b57' : '#bbf7d0';
    roundRect(x, y, w, w, 6);
    ctx.fill();
    ctx.restore();

    /* 眼睛：沿行进方向前移，左右各一只 */
    const d = props.game.dir;
    const cx = head.x * CELL + CELL / 2;
    const cy = head.y * CELL + CELL / 2;
    const ex = cx + d.x * CELL * 0.20;
    const ey = cy + d.y * CELL * 0.20;
    const px = -d.y;
    const py = d.x;
    ctx.fillStyle = props.dead ? '#22331f' : '#062b16';
    const signs = [-1, 1];
    for (const sign of signs) {
        const gx = ex + px * CELL * 0.20 * sign;
        const gy = ey + py * CELL * 0.20 * sign;
        ctx.beginPath();
        ctx.arc(gx, gy, CELL * 0.105, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawFlash() {
    if (!ctx || !props.flash) {
        return;
    }
    const now = performance.now();
    const flash = props.flash;
    if (now >= flash.until) {
        return; // 过期由 App.vue 清掉，这里只是不画
    }
    const progress = 1 - (flash.until - now) / FLASH_MS;
    const cx = (flash.x + 0.5) * CELL;
    const cy = (flash.y + 0.5) * CELL;
    ctx.save();
    ctx.strokeStyle = 'rgba(253, 224, 71, ' + ((1 - progress) * 0.9).toFixed(3) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, CELL * (0.3 + progress * 0.9), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

function draw() {
    if (!ctx) {
        return;
    }
    ctx.fillStyle = '#060a07';
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);
    drawGrid();
    drawFood();
    drawSnake();
    drawFlash();
}

onMounted(resize);

defineExpose({ draw });
</script>

<template>
    <canvas id="board" ref="canvasRef" width="528" height="440"></canvas>
</template>
