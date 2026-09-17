/**
 * 贪吃蛇纯逻辑（不碰 DOM，无 Vue 依赖），由旧 webviewContent.ts 的 SNAKE IIFE 逐行移植。
 * 供 App.vue 和 vitest 测试共用。rand 参数可注入（缺省 Math.random，行为与旧版一致）。
 */

export const COLS = 24;
export const ROWS = 20;
export const FOODS_PER_LEVEL = 5;   /* 每吃满这么多个食物升一级 */

/* 速度曲线：一级 200ms 一步，每级快 10ms，最快 80ms 封顶。 */
export const BASE_INTERVAL = 200;
const SPEED_STEP = 10;
const MIN_INTERVAL = 80;

export interface Point {
    x: number;
    y: number;
}

export interface SnakeState {
    snake: Point[];                 /* 蛇头在前（下标 0） */
    dir: Point;
    queue: Point[];                 /* 待生效的转向，最多两拍 */
    food: Point | null;
    score: number;
    eaten: number;
    level: number;
    alive: boolean;
}

export type StepResult = 'ok' | 'ate' | 'wall' | 'self' | 'win';

export function createState(rand: () => number = Math.random): SnakeState {
    const cy = Math.floor(ROWS / 2);
    const snake: Point[] = [];
    /* 蛇头在前（下标 0），出发朝右，前方留出足够空间 */
    for (let i = 0; i < 4; i++) {
        snake.push({ x: 3 + (4 - 1 - i), y: cy });
    }
    const state: SnakeState = {
        snake,
        dir: { x: 1, y: 0 },
        queue: [],
        food: null,
        score: 0,
        eaten: 0,
        level: 1,
        alive: true
    };
    state.food = spawnFood(state, rand);
    return state;
}

/** 在所有空格里等概率选一个。整盘吃满时返回 null（= 通关）。 */
export function spawnFood(state: SnakeState, rand: () => number): Point | null {
    const taken = Object.create(null) as Record<number, boolean>;
    for (const seg of state.snake) {
        taken[seg.y * COLS + seg.x] = true;
    }
    const free: Point[] = [];
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            if (!taken[y * COLS + x]) {
                free.push({ x, y });
            }
        }
    }
    if (!free.length) {
        return null;
    }
    return free[Math.floor(rand() * free.length)];
}

/**
 * 记下下一次转向。方向和「队列里最后一个方向」比较（没有则比当前方向），
 * 禁止 180° 反向；队列最多存两拍，这样同一拍内连按两次也不会拐错。
 */
export function queueDirection(state: SnakeState, dx: number, dy: number): boolean {
    const last = state.queue.length ? state.queue[state.queue.length - 1] : state.dir;
    if (dx === -last.x && dy === -last.y) {
        return false;
    }
    if (dx === last.x && dy === last.y) {
        return false;
    }
    if (state.queue.length >= 2) {
        return false;
    }
    state.queue.push({ x: dx, y: dy });
    return true;
}

export function intervalFor(level: number): number {
    return Math.max(MIN_INTERVAL, BASE_INTERVAL - (level - 1) * SPEED_STEP);
}

/** 走一步。返回 'ok'（普通前进）｜'ate'（吃到食物）｜'wall'｜'self'｜'win'（吃满整盘）。 */
export function step(state: SnakeState, rand: () => number): StepResult {
    if (!state.alive) {
        return 'ok';
    }

    if (state.queue.length) {
        state.dir = state.queue.shift() as Point;
    }

    const head = state.snake[0];
    const nx = head.x + state.dir.x;
    const ny = head.y + state.dir.y;

    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
        state.alive = false;
        return 'wall';
    }

    const eating = !!state.food && state.food.x === nx && state.food.y === ny;

    /* 不吃食物时尾巴这一格会腾出来，所以撞到「当前尾巴」不算死 */
    const limit = eating ? state.snake.length : state.snake.length - 1;
    for (let i = 0; i < limit; i++) {
        if (state.snake[i].x === nx && state.snake[i].y === ny) {
            state.alive = false;
            return 'self';
        }
    }

    state.snake.unshift({ x: nx, y: ny });

    if (!eating) {
        state.snake.pop();
        return 'ok';
    }

    state.eaten++;
    state.level = 1 + Math.floor(state.eaten / FOODS_PER_LEVEL);
    state.score += 10 * state.level;
    state.food = spawnFood(state, rand);
    return state.food ? 'ate' : 'win';
}
