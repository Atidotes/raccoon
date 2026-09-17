<script setup lang="ts">
/**
 * CRT 机箱共享组件（tetris / snake 共用）：屏幕 + 扫描线 + 标题栏 + 遮罩 + 侧栏。
 * 样式逐行搬运自旧版 webviewContent.ts 的模板 CSS，视觉保持不变。
 */
defineProps<{
    title: string;
    subtitle: string;
    overlayVisible: boolean;
    overlayTitle: string;
    overlayText: string;
    overlayHint: string;
}>();
</script>

<template>
    <div class="cabinet">
        <div class="screen">
            <div class="title-bar">
                <span class="title">{{ title }}</span>
                <span class="subtitle">{{ subtitle }}</span>
            </div>

            <div class="game-area">
                <div class="board-wrap">
                    <slot name="board" />

                    <div class="overlay" v-show="overlayVisible">
                        <div class="overlay-title">{{ overlayTitle }}</div>
                        <div class="overlay-text">{{ overlayText }}</div>
                        <div class="overlay-hint">{{ overlayHint }}</div>
                    </div>
                </div>

                <aside class="sidebar">
                    <slot name="sidebar" />
                </aside>
            </div>
        </div>

        <div class="controls-bar">
            <slot name="controls" />
        </div>
    </div>
</template>

<!-- 页面级样式：html/body 不在组件根内，scoped 不会命中 -->
<style>
  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    min-height: 100vh;
    background: #050505;
    font-family: "Courier New", Courier, monospace;
    color: #4ade80;
    user-select: none;
    -webkit-user-select: none;
  }

  body {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    overflow: auto;
    background:
      radial-gradient(ellipse at 50% 40%, #101614 0%, #030403 70%);
  }
</style>

<style scoped>
  /* ---------- 机箱 ---------- */
  .cabinet {
    position: relative;
    padding: 16px;
    border-radius: 14px;
    background: linear-gradient(180deg, #1c2320 0%, #0b0e0c 100%);
    border: 2px solid #2d3b33;
    box-shadow:
      0 0 0 1px #000,
      0 0 50px rgba(74, 222, 128, 0.10),
      inset 0 0 60px rgba(0, 0, 0, 0.9);
  }

  /* ---------- 屏幕 ---------- */
  .screen {
    position: relative;
    padding: 14px;
    border-radius: 8px;
    background: #060a07;
    overflow: hidden;
    box-shadow:
      inset 0 0 50px rgba(0, 0, 0, 0.95),
      inset 0 0 10px rgba(74, 222, 128, 0.12);
  }

  /* 扫描线 + 暗角 */
  .screen::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 30;
    background:
      repeating-linear-gradient(
        to bottom,
        rgba(0, 0, 0, 0.20) 0px,
        rgba(0, 0, 0, 0.20) 1px,
        rgba(0, 0, 0, 0) 1px,
        rgba(0, 0, 0, 0) 3px
      ),
      radial-gradient(ellipse at center, rgba(0,0,0,0) 50%, rgba(0,0,0,0.6) 100%);
  }

  /* 扫过的亮带 */
  .screen::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    height: 140px;
    top: -140px;
    pointer-events: none;
    z-index: 31;
    background: linear-gradient(
      to bottom,
      rgba(74, 222, 128, 0) 0%,
      rgba(74, 222, 128, 0.05) 50%,
      rgba(74, 222, 128, 0) 100%
    );
    animation: sweep 7s linear infinite;
  }

  @keyframes sweep {
    0%   { top: -140px; }
    100% { top: 100%; }
  }

  /* ---------- 标题栏 ---------- */
  .title-bar {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid #1f3a28;
  }

  .title {
    font-size: 16px;
    font-weight: bold;
    letter-spacing: 6px;
    color: #4ade80;
    text-shadow:
      0 0 8px rgba(74, 222, 128, 0.9),
      0 0 22px rgba(74, 222, 128, 0.45);
    animation: flicker 4s infinite;
  }

  @keyframes flicker {
    0%, 100%      { opacity: 1; }
    91%, 93%      { opacity: 1; }
    92%           { opacity: 0.55; }
    95%           { opacity: 1; }
    96%           { opacity: 0.75; }
    97%           { opacity: 1; }
  }

  .subtitle {
    font-size: 10px;
    letter-spacing: 2px;
    color: #2f855a;
  }

  /* ---------- 布局 ---------- */
  .game-area {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }

  .board-wrap {
    position: relative;
    line-height: 0;
    border: 1px solid #1f3a28;
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 0 24px rgba(74, 222, 128, 0.08);
  }

  /* 棋盘 canvas 是父组件插槽内容，scoped 样式不会命中，要用 :slotted */
  :slotted(canvas#board) {
    display: block;
    background: #060a07;
  }

  /* ---------- 侧栏 ---------- */
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 122px;
  }

  :slotted(.panel) {
    border: 1px solid #1f3a28;
    border-radius: 4px;
    background: rgba(74, 222, 128, 0.03);
    padding: 6px 8px 8px;
    box-shadow: inset 0 0 16px rgba(0, 0, 0, 0.6);
  }

  :slotted(.panel-label) {
    font-size: 10px;
    letter-spacing: 2px;
    color: #2f855a;
    margin-bottom: 6px;
  }

  :slotted(.panel-value) {
    font-size: 18px;
    font-weight: bold;
    letter-spacing: 1px;
    text-align: right;
    color: #86efac;
    text-shadow: 0 0 8px rgba(74, 222, 128, 0.75);
  }

  :slotted(.panel-value.small) {
    font-size: 14px;
  }

  /* ---------- 遮罩层 ---------- */
  .overlay {
    position: absolute;
    inset: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 20px;
    text-align: center;
    background: rgba(3, 7, 4, 0.88);
  }

  .overlay-title {
    font-size: 22px;
    font-weight: bold;
    letter-spacing: 5px;
    color: #4ade80;
    text-shadow:
      0 0 12px rgba(74, 222, 128, 0.95),
      0 0 30px rgba(74, 222, 128, 0.5);
  }

  .overlay-text {
    font-size: 14px;
    letter-spacing: 2px;
    color: #86efac;
  }

  .overlay-hint {
    font-size: 11px;
    letter-spacing: 1px;
    color: #2f855a;
    animation: blink 1.2s step-end infinite;
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.2; }
  }

  /* ---------- 底部操作说明 ---------- */
  .controls-bar {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px 18px;
    margin-top: 14px;
    font-size: 10px;
    letter-spacing: 1px;
    color: #2f855a;
  }

  .controls-bar :slotted(b) {
    color: #4ade80;
    font-weight: bold;
  }
</style>
