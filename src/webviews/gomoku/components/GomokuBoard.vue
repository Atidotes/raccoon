<script setup lang="ts">
/**
 * 五子棋棋盘 Canvas：绘制与鼠标交互从旧版 webviewContent.ts 逐行直译。
 * 落子合法性（回合、占位）由 App.vue 判断，这里只上报点击的交叉点。
 * 悬停预览是本组件内部状态，自行重绘；其余重绘由 App 在状态变化后显式调 draw()。
 */
import { onMounted, ref } from 'vue';
import { BLACK, SIZE } from '../logic/engine';
import type { Point } from '../logic/engine';

interface Stone extends Point {
    color: number;
}

const props = defineProps<{
    history: Stone[];
    winLine: Point[] | null;
    humanTurn: boolean;
    gameOver: boolean;
}>();

const emit = defineEmits<{
    (e: 'place', cell: Point | null): void;
}>();

const CELL = 34;                                /* 格子像素 */
const PAD = 26;                                 /* 棋盘四周留白 */
const BOARD_PX = PAD * 2 + (SIZE - 1) * CELL;   /* 26*2 + 14*34 = 528 */

const canvasRef = ref<HTMLCanvasElement | null>(null);
let ctx: CanvasRenderingContext2D | null = null;
let hover: Point | null = null;

function resize() {
    if (!canvasRef.value) {
        return;
    }
    const dpr = window.devicePixelRatio || 1;
    canvasRef.value.width = BOARD_PX * dpr;
    canvasRef.value.height = BOARD_PX * dpr;
    canvasRef.value.style.width = BOARD_PX + 'px';
    canvasRef.value.style.height = BOARD_PX + 'px';
    ctx = canvasRef.value.getContext('2d');
    if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
}

function cellCenter(x: number, y: number): { cx: number; cy: number } {
    return { cx: PAD + x * CELL, cy: PAD + y * CELL };
}

function cellFromEvent(e: MouseEvent): Point | null {
    const rect = canvasRef.value!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const gx = Math.round((px - PAD) / CELL);
    const gy = Math.round((py - PAD) / CELL);
    if (gx < 0 || gx >= SIZE || gy < 0 || gy >= SIZE) {
        return null;
    }
    const c = cellCenter(gx, gy);
    /* 点到离交叉点太远的地方不算数 */
    if (Math.abs(px - c.cx) > CELL * 0.45 || Math.abs(py - c.cy) > CELL * 0.45) {
        return null;
    }
    return { x: gx, y: gy };
}

function drawStone(m: Stone | { x: number; y: number; color: number }, isLast: boolean, alpha?: number) {
    if (!ctx) {
        return;
    }
    const c = cellCenter(m.x, m.y);
    const r = CELL * 0.42;
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    /* 落子阴影 */
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    ctx.arc(c.cx + 1.5, c.cy + 2.5, r, 0, Math.PI * 2);
    ctx.fill();
    /* 棋子本体：径向渐变做光泽 */
    const g = ctx.createRadialGradient(c.cx - r * 0.35, c.cy - r * 0.4, r * 0.15, c.cx, c.cy, r);
    if (m.color === BLACK) {
        g.addColorStop(0, '#6d6d6d');
        g.addColorStop(1, '#0e0e0e');
    } else {
        g.addColorStop(0, '#ffffff');
        g.addColorStop(1, '#b9b9b9');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.cx, c.cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    /* 最后一手的红点标记 */
    if (isLast) {
        ctx.fillStyle = '#e23434';
        ctx.beginPath();
        ctx.arc(c.cx, c.cy, 3.5, 0, Math.PI * 2);
        ctx.fill();
    }
}

function draw() {
    if (!ctx) {
        return;
    }
    /* 闭包里的 forEach 不会保留外层收窄，先取一个非空局部引用 */
    const c2d = ctx;

    /* 木板底色 */
    const bg = c2d.createLinearGradient(0, 0, BOARD_PX, BOARD_PX);
    bg.addColorStop(0, '#e2b36a');
    bg.addColorStop(1, '#cd9548');
    c2d.fillStyle = bg;
    c2d.fillRect(0, 0, BOARD_PX, BOARD_PX);

    /* 网格线 */
    c2d.strokeStyle = 'rgba(78, 46, 18, 0.85)';
    c2d.lineWidth = 1;
    const from = PAD;
    const to = PAD + (SIZE - 1) * CELL;
    for (let i = 0; i < SIZE; i++) {
        const p = PAD + i * CELL;
        c2d.beginPath();
        c2d.moveTo(from, p);
        c2d.lineTo(to, p);
        c2d.stroke();
        c2d.beginPath();
        c2d.moveTo(p, from);
        c2d.lineTo(p, to);
        c2d.stroke();
    }

    /* 星位（天元 + 四个角星） */
    const stars = [[3, 3], [11, 3], [3, 11], [11, 11], [7, 7]];
    c2d.fillStyle = 'rgba(78, 46, 18, 0.9)';
    stars.forEach((s) => {
        const c = cellCenter(s[0], s[1]);
        c2d.beginPath();
        c2d.arc(c.cx, c.cy, 4, 0, Math.PI * 2);
        c2d.fill();
    });

    /* 棋子 */
    for (let j = 0; j < props.history.length; j++) {
        drawStone(props.history[j], j === props.history.length - 1);
    }

    /* 胜利五子高亮 */
    if (props.winLine) {
        c2d.strokeStyle = 'rgba(255, 64, 64, 0.95)';
        c2d.lineWidth = 3;
        props.winLine.forEach((cell) => {
            const c = cellCenter(cell.x, cell.y);
            c2d.beginPath();
            c2d.arc(c.cx, c.cy, CELL * 0.44, 0, Math.PI * 2);
            c2d.stroke();
        });
    }

    /* 悬停预览（半透明黑子） */
    if (hover && props.humanTurn && !props.gameOver) {
        drawStone({ x: hover.x, y: hover.y, color: BLACK }, false, 0.45);
    }
}

function onClick(e: MouseEvent): void {
    emit('place', cellFromEvent(e));
}

function onMousemove(e: MouseEvent): void {
    hover = cellFromEvent(e);
    draw();
}

function onMouseleave(): void {
    hover = null;
    draw();
}

onMounted(() => {
    resize();
    draw();
});

defineExpose({ draw });
</script>

<template>
    <canvas id="board" ref="canvasRef" @click="onClick" @mousemove="onMousemove" @mouseleave="onMouseleave"></canvas>
</template>
