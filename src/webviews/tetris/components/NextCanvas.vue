<script setup lang="ts">
/**
 * NEXT 预览 Canvas：drawNext 从旧版 webviewContent.ts 逐行直译。
 * 旧版只在 spawn/start 时调用，新版由 App 每帧调 draw()——内容只在 spawn 时变化，
 * 视觉无差。
 */
import { onMounted, ref } from 'vue';
import { COLORS, SHAPES } from '../logic/engine';
import type { TetrisGame } from '../logic/engine';

const props = defineProps<{
    game: TetrisGame;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
let nctx: CanvasRenderingContext2D | null = null;

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

function draw() {
    if (!nctx || !canvasRef.value) {
        return;
    }
    nctx.clearRect(0, 0, canvasRef.value.width, canvasRef.value.height);

    const nextPiece = props.game.nextPiece;
    if (!nextPiece) {
        return;
    }

    const m = SHAPES[nextPiece.type];
    let minR = 99;
    let maxR = -1;
    let minC = 99;
    let maxC = -1;

    for (let r = 0; r < m.length; r++) {
        for (let c = 0; c < m[r].length; c++) {
            if (m[r][c]) {
                if (r < minR) {
                    minR = r;
                }
                if (r > maxR) {
                    maxR = r;
                }
                if (c < minC) {
                    minC = c;
                }
                if (c > maxC) {
                    maxC = c;
                }
            }
        }
    }

    const w = maxC - minC + 1;
    const h = maxR - minR + 1;
    const cell = 22;
    const offsetX = (canvasRef.value.width - w * cell) / 2;
    const offsetY = (canvasRef.value.height - h * cell) / 2;

    for (let rr = minR; rr <= maxR; rr++) {
        for (let cc = minC; cc <= maxC; cc++) {
            if (!m[rr][cc]) {
                continue;
            }
            drawBlock(
                nctx,
                offsetX + (cc - minC) * cell,
                offsetY + (rr - minR) * cell,
                cell,
                COLORS[nextPiece.type]
            );
        }
    }
}

onMounted(() => {
    nctx = canvasRef.value?.getContext('2d') ?? null;
    draw();
});

defineExpose({ draw });
</script>

<template>
    <canvas id="next" ref="canvasRef" width="104" height="104"></canvas>
</template>

<style scoped>
  /* 旧版模板里 canvas#next 的专属样式 */
  canvas#next {
    display: block;
    width: 104px;
    height: 104px;
    margin: 0 auto;
  }
</style>
