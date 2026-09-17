import { defineConfig } from 'vitest/config';

/**
 * 测试配置。独立于 vite.config.ts（root 指到 src/webviews，会影响测试），
 * 全部测试在 node 环境跑：三个游戏引擎 + deepseek + markdown 纯函数。
 */
export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts']
    }
});
