/**
 * 贪吃蛇引擎测试：由旧版「正则抽出 <script> 块在 Node 里跑」的 31 条断言直译而来。
 * 迁移后再加新行为，直接在这里补用例。
 */
import { describe, expect, it } from 'vitest';
import {
    BASE_INTERVAL,
    COLS,
    FOODS_PER_LEVEL,
    ROWS,
    SnakeState,
    createState,
    intervalFor,
    queueDirection,
    spawnFood,
    step
} from '../../../src/webviews/snake/logic/engine';

/** 固定随机数：生成食物永远取空格列表第一个（左上角），让测试可复现。 */
const fixedRand = () => 0;

function eatTimes(state: SnakeState, n: number): void {
    for (let i = 0; i < n; i++) {
        state.food = { x: state.snake[0].x + 1, y: state.snake[0].y };
        step(state, fixedRand);
    }
}

describe('初始状态', () => {
    it('初始长度 4', () => {
        expect(createState().snake).toHaveLength(4);
    });

    it('蛇头在最前且朝右有空间', () => {
        const s = createState();
        expect(s.snake[0]).toEqual({ x: 6, y: 10 });
        expect(s.dir).toEqual({ x: 1, y: 0 });
    });

    it('初始等级 1、得分 0', () => {
        const s = createState();
        expect(s.level).toBe(1);
        expect(s.score).toBe(0);
    });

    it('食物在空格上', () => {
        const s = createState();
        expect(s.food).not.toBeNull();
        expect(s.snake.some((p) => p.x === s.food!.x && p.y === s.food!.y)).toBe(false);
    });
});

describe('前进', () => {
    it('step 返回 ok', () => {
        const s = createState();
        expect(step(s, fixedRand)).toBe('ok');
    });

    it('前进后长度不变', () => {
        const s = createState();
        step(s, fixedRand);
        expect(s.snake).toHaveLength(4);
    });

    it('头右移一格', () => {
        const s = createState();
        const head0 = s.snake[0];
        step(s, fixedRand);
        expect(s.snake[0]).toEqual({ x: head0.x + 1, y: head0.y });
    });

    it('尾巴跟着挪', () => {
        const s = createState();
        const tail0 = s.snake[3];
        step(s, fixedRand);
        // 尾巴腾出来的那一格被前一段占住
        expect(s.snake[3]).toEqual({ x: tail0.x + 1, y: tail0.y });
    });
});

describe('撞墙', () => {
    it('一路向右会撞墙，头停在 x=23', () => {
        const s = createState();
        s.food = null; // 挪开食物，只测撞墙
        let result = 'ok' as ReturnType<typeof step>;
        let steps = 0;
        while (result === 'ok' && steps < 50) {
            result = step(s, fixedRand);
            steps++;
        }
        expect(result).toBe('wall');
        expect(s.alive).toBe(false);
        expect(s.snake[0]).toEqual({ x: 23, y: 10 });
    });
});

describe('转向队列', () => {
    it('不能 180° 反向右→左', () => {
        const s = createState();
        expect(queueDirection(s, -1, 0)).toBe(false);
    });

    it('同方向重复按无效', () => {
        const s = createState();
        expect(queueDirection(s, 1, 0)).toBe(false);
    });

    it('可以转上', () => {
        const s = createState();
        expect(queueDirection(s, 0, -1)).toBe(true);
    });

    it('连按两拍依次生效，不会拐错', () => {
        const s = createState();
        expect(queueDirection(s, 0, -1)).toBe(true);
        expect(queueDirection(s, -1, 0)).toBe(true);
        step(s, fixedRand);
        expect(s.dir).toEqual({ x: 0, y: -1 });
        step(s, fixedRand);
        expect(s.dir).toEqual({ x: -1, y: 0 });
    });

    it('队列最多存两拍', () => {
        const s = createState();
        queueDirection(s, 0, -1);
        queueDirection(s, -1, 0);
        expect(queueDirection(s, 0, 1)).toBe(false);
    });
});

describe('吃食物', () => {
    it('吃到食物返回 ate 且长度 +1', () => {
        const s = createState();
        s.food = { x: s.snake[0].x + 1, y: s.snake[0].y };
        expect(step(s, fixedRand)).toBe('ate');
        expect(s.snake).toHaveLength(5);
    });

    it('一级每个食物 10 分', () => {
        const s = createState();
        s.food = { x: s.snake[0].x + 1, y: s.snake[0].y };
        step(s, fixedRand);
        expect(s.score).toBe(10);
    });

    it('满 5 个食物升到 2 级，升级后按新等级计分', () => {
        const s = createState();
        eatTimes(s, FOODS_PER_LEVEL);
        expect(s.eaten).toBe(5);
        expect(s.level).toBe(2);
        // 前 4 个按 1 级各 10 分，第 5 个按 2 级 20 分
        expect(s.score).toBe(10 + 10 + 10 + 10 + 20);
    });
});

describe('速度曲线', () => {
    it('1 级 200ms 起步', () => {
        expect(intervalFor(1)).toBe(BASE_INTERVAL);
    });

    it('每级快 10ms', () => {
        expect(intervalFor(2)).toBe(BASE_INTERVAL - 10);
    });

    it('80ms 封顶', () => {
        expect(intervalFor(99)).toBe(80);
    });

    it('单调递减', () => {
        expect(intervalFor(1)).toBeGreaterThan(intervalFor(2));
        expect(intervalFor(2)).toBeGreaterThan(intervalFor(3));
    });
});

describe('撞自己', () => {
    it('撞到自己算 self', () => {
        const s = createState();
        // 绕成 U 形，头在 (5,5) 朝下撞向 (5,6)
        s.snake = [
            { x: 5, y: 5 },
            { x: 4, y: 5 },
            { x: 4, y: 6 },
            { x: 5, y: 6 },
            { x: 6, y: 6 }
        ];
        s.dir = { x: 0, y: 1 };
        s.food = null;
        expect(step(s, fixedRand)).toBe('self');
        expect(s.alive).toBe(false);
    });

    it('撞「当前尾巴」不算死（尾巴会腾开）', () => {
        const s = createState();
        s.snake = [
            { x: 5, y: 5 },
            { x: 4, y: 5 },
            { x: 4, y: 6 },
            { x: 5, y: 6 }
        ];
        s.dir = { x: 0, y: 1 };
        s.food = { x: 0, y: 0 };
        expect(step(s, fixedRand)).toBe('ok');
        expect(s.alive).toBe(true);
    });

    it('吃食物变长的那一拍尾巴不让位，撞上算死', () => {
        const s = createState();
        s.snake = [
            { x: 5, y: 5 },
            { x: 4, y: 5 },
            { x: 4, y: 6 },
            { x: 5, y: 6 }
        ];
        s.dir = { x: 0, y: 1 };
        s.food = { x: 5, y: 6 }; // 食物在尾巴上：吃下时尾巴不让位
        expect(step(s, fixedRand)).toBe('self');
        expect(s.alive).toBe(false);
    });
});

describe('食物生成', () => {
    it('500 次生成都在盘内空格', () => {
        for (let i = 0; i < 500; i++) {
            const s = createState();
            const f = s.food!;
            expect(s.snake.some((p) => p.x === f.x && p.y === f.y)).toBe(false);
            expect(f.x).toBeGreaterThanOrEqual(0);
            expect(f.x).toBeLessThan(COLS);
            expect(f.y).toBeGreaterThanOrEqual(0);
            expect(f.y).toBeLessThan(ROWS);
        }
    });

    it('食物能落在盘的每个空格（分布均匀）', () => {
        const s = createState();
        const seen = new Set<number>();
        for (let i = 0; i < 4000; i++) {
            const f = spawnFood(s, Math.random)!;
            seen.add(f.y * COLS + f.x);
        }
        expect(seen.size).toBeGreaterThan(400);
    });
});

describe('通关与死亡', () => {
    it('吃满整盘返回 win 且 alive 保持 true', () => {
        const s = createState();
        // 构造只剩一个空格的局面：食物在 (1,0)，蛇头 (0,0) 朝右
        s.snake = [];
        for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
                if (x === 1 && y === 0) continue;
                s.snake.push({ x, y });
            }
        }
        s.snake.unshift(s.snake.pop() as { x: number; y: number });
        s.snake = [{ x: 0, y: 0 }].concat(s.snake.filter((p) => !(p.x === 0 && p.y === 0)));
        s.dir = { x: 1, y: 0 };
        s.food = { x: 1, y: 0 };
        expect(step(s, fixedRand)).toBe('win');
        expect(s.alive).toBe(true);
    });

    it('死后 step 安全返回 ok', () => {
        const s = createState();
        s.alive = false;
        expect(step(s, fixedRand)).toBe('ok');
    });
});
