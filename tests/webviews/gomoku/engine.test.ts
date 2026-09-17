/**
 * 五子棋引擎测试。旧版没有正式测试（AI 靠手工抽 <script> 块验证），
 * 这里把胜负判定、候选点、AI 底线反应钉死。
 */
import { describe, expect, it } from 'vitest';
import {
    BLACK,
    Board,
    EMPTY,
    WHITE,
    checkWin,
    candidateCells,
    countRun,
    createBoard,
    evalPoint,
    findBestMove
} from '../../../src/webviews/gomoku/logic/engine';

/** 在棋盘上摆一串同色子（x,y 列表），返回最后一子的坐标。 */
function place(board: Board, cells: Array<[number, number]>, color: number): [number, number] {
    for (const [x, y] of cells) {
        board[y][x] = color;
    }
    return cells[cells.length - 1];
}

/** 从 1 到 199 的确定性伪随机（用于「随机局面不抛异常」测试）。 */
function seededRand(seed: number): () => number {
    let s = seed;
    return () => {
        s = (s * 9301 + 49297) % 233280;
        return s / 233280;
    };
}

describe('checkWin', () => {
    it('横线五连', () => {
        const b = createBoard();
        const [x, y] = place(b, [[3, 5], [4, 5], [5, 5], [6, 5], [7, 5]], BLACK);
        expect(checkWin(b, x, y, BLACK)).toEqual([
            { x: 3, y: 5 }, { x: 4, y: 5 }, { x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }
        ]);
    });

    it('竖线五连', () => {
        const b = createBoard();
        const [x, y] = place(b, [[5, 3], [5, 4], [5, 5], [5, 6], [5, 7]], BLACK);
        expect(checkWin(b, x, y, BLACK)).toHaveLength(5);
        expect(checkWin(b, x, y, BLACK)?.[0]).toEqual({ x: 5, y: 3 });
    });

    it('两条对角线五连', () => {
        const b1 = createBoard();
        const [x1, y1] = place(b1, [[3, 3], [4, 4], [5, 5], [6, 6], [7, 7]], BLACK);
        expect(checkWin(b1, x1, y1, BLACK)).toEqual([
            { x: 3, y: 3 }, { x: 4, y: 4 }, { x: 5, y: 5 }, { x: 6, y: 6 }, { x: 7, y: 7 }
        ]);

        const b2 = createBoard();
        const [x2, y2] = place(b2, [[3, 7], [4, 6], [5, 5], [6, 4], [7, 3]], BLACK);
        expect(checkWin(b2, x2, y2, BLACK)).toEqual([
            { x: 3, y: 7 }, { x: 4, y: 6 }, { x: 5, y: 5 }, { x: 6, y: 4 }, { x: 7, y: 3 }
        ]);
    });

    it('四连不算赢', () => {
        const b = createBoard();
        const [x, y] = place(b, [[3, 5], [4, 5], [5, 5], [6, 5]], BLACK);
        expect(checkWin(b, x, y, BLACK)).toBeNull();
    });

    it('六子长连也算赢（run>=5），高亮起点是连子起点', () => {
        const b = createBoard();
        const [x, y] = place(b, [[2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5]], BLACK);
        const line = checkWin(b, x, y, BLACK);
        expect(line).not.toBeNull();
        expect(line).toHaveLength(5);
        expect(line?.[0]).toEqual({ x: 2, y: 5 });
    });

    it('空盘无胜负', () => {
        expect(checkWin(createBoard(), 7, 7, BLACK)).toBeNull();
    });
});

describe('countRun', () => {
    it('两端都空 open=2', () => {
        const b = createBoard();
        place(b, [[5, 5], [6, 5], [7, 5]], BLACK);
        expect(countRun(b, 5, 5, 1, 0, BLACK)).toMatchObject({ run: 3, open: 2, startX: 5, startY: 5 });
    });

    it('一端被堵 open=1', () => {
        const b = createBoard();
        place(b, [[5, 5], [6, 5], [7, 5]], BLACK);
        b[5][8] = WHITE;
        expect(countRun(b, 5, 5, 1, 0, BLACK)).toMatchObject({ run: 3, open: 1 });
    });
});

describe('candidateCells', () => {
    it('空盘只返回天元', () => {
        expect(candidateCells(createBoard())).toEqual([{ x: 7, y: 7 }]);
    });

    it('单子周围两格内的空位（5×5-1）', () => {
        const b = createBoard();
        b[7][7] = BLACK;
        const cells = candidateCells(b);
        expect(cells).toHaveLength(24);
        expect(cells.some((c) => c.x === 7 && c.y === 7)).toBe(false);
        expect(cells.every((c) => Math.abs(c.x - 7) <= 2 && Math.abs(c.y - 7) <= 2)).toBe(true);
    });

    it('去重且不含已占格', () => {
        const b = createBoard();
        place(b, [[7, 7], [8, 8]], BLACK);
        const cells = candidateCells(b);
        const seen = new Set(cells.map((c) => `${c.x},${c.y}`));
        expect(seen.size).toBe(cells.length);
        expect(cells.some((c) => (c.x === 7 && c.y === 7) || (c.x === 8 && c.y === 8))).toBe(false);
    });
});

describe('evalPoint', () => {
    it('空盘中心得分高于角落（中心加成）', () => {
        const b = createBoard();
        expect(evalPoint(b, 7, 7, BLACK)).toBeGreaterThan(evalPoint(b, 0, 0, BLACK));
    });

    it('活四分 > 冲四分的单调性', () => {
        const openThree = createBoard();
        place(openThree, [[5, 5], [6, 5], [7, 5]], BLACK);
        const closedThree = createBoard();
        place(closedThree, [[5, 5], [6, 5], [7, 5]], BLACK);
        closedThree[5][9] = WHITE; // 堵住 (8,5) 的远端 (9,5)
        // 在 (8,5) 落子：活四 vs 冲四
        expect(evalPoint(openThree, 8, 5, BLACK)).toBeGreaterThan(evalPoint(closedThree, 8, 5, BLACK));
    });
});

describe('findBestMove 底线反应（三个难度共享）', () => {
    it('自己能立即成五 → 直接收', () => {
        const b = createBoard();
        place(b, [[4, 7], [5, 7], [6, 7], [7, 7]], BLACK);
        const move = findBestMove(b, BLACK, WHITE, 'hard', () => 0.5);
        expect(move).not.toBeNull();
        expect([{ x: 8, y: 7 }, { x: 3, y: 7 }]).toContainEqual({ x: move!.x, y: move!.y });
    });

    it('对方一步成五 → 必须堵', () => {
        const b = createBoard();
        place(b, [[4, 7], [5, 7], [6, 7], [7, 7]], WHITE);
        const move = findBestMove(b, BLACK, WHITE, 'hard', () => 0.5);
        expect(move).not.toBeNull();
        expect([{ x: 8, y: 7 }, { x: 3, y: 7 }]).toContainEqual({ x: move!.x, y: move!.y });
    });

    it('自己能成活四 → 直接做', () => {
        const b = createBoard();
        place(b, [[5, 5], [6, 5], [7, 5]], BLACK);
        const move = findBestMove(b, BLACK, WHITE, 'hard', () => 0.5);
        expect(move).not.toBeNull();
        expect([{ x: 4, y: 5 }, { x: 8, y: 5 }]).toContainEqual({ x: move!.x, y: move!.y });
    });

    it('对方要成活四 → 必堵', () => {
        const b = createBoard();
        place(b, [[5, 5], [6, 5], [7, 5]], WHITE);
        const move = findBestMove(b, BLACK, WHITE, 'hard', () => 0.5);
        expect(move).not.toBeNull();
        expect([{ x: 4, y: 5 }, { x: 8, y: 5 }]).toContainEqual({ x: move!.x, y: move!.y });
    });
});

describe('findBestMove 难度差异', () => {
    /** 造一个双方都有若干棋子的中盘局面。 */
    function midgame(): Board {
        const b = createBoard();
        place(b, [[7, 7], [6, 6], [7, 8], [8, 7], [6, 8], [8, 6]], BLACK);
        place(b, [[7, 6], [6, 7], [8, 8], [5, 6], [7, 9]], WHITE);
        return b;
    }

    it('easy 只在它自己打分的前三里随机', () => {
        const b = midgame();
        const ranked = candidateCells(b).map((c) => ({
            ...c,
            attack: evalPoint(b, c.x, c.y, BLACK),
            defense: evalPoint(b, c.x, c.y, WHITE)
        }));
        const top3 = ranked
            .slice()
            .sort((a, d) => d.attack * 0.5 + d.defense * 0.9 - (a.attack * 0.5 + a.defense * 0.9))
            .slice(0, 3);
        for (let i = 0; i < 50; i++) {
            const move = findBestMove(b, BLACK, WHITE, 'easy', Math.random);
            expect(move).not.toBeNull();
            expect(top3.some((t) => t.x === move!.x && t.y === move!.y)).toBe(true);
        }
    });

    it('medium 在最高分 98% 带内随机', () => {
        const b = midgame();
        const ranked = candidateCells(b).map((c) => ({
            ...c,
            attack: evalPoint(b, c.x, c.y, BLACK),
            defense: evalPoint(b, c.x, c.y, WHITE)
        }));
        const valueOf = (m: { attack: number; defense: number }) => m.attack + m.defense * 0.9;
        const maxVal = Math.max(...ranked.map(valueOf));
        for (let i = 0; i < 50; i++) {
            const move = findBestMove(b, BLACK, WHITE, 'medium', Math.random);
            expect(move).not.toBeNull();
            const m = ranked.find((r) => r.x === move!.x && r.y === move!.y)!;
            expect(valueOf(m)).toBeGreaterThanOrEqual(maxVal * 0.98);
        }
    });

    it('hard 返回合法空位且不改动棋盘（一层回击模拟要恢复现场）', () => {
        const b = midgame();
        const snapshot = JSON.stringify(b);
        const move = findBestMove(b, BLACK, WHITE, 'hard', () => 0.5);
        expect(move).not.toBeNull();
        expect(b[move!.y][move!.x]).toBe(EMPTY);
        expect(JSON.stringify(b)).toBe(snapshot);
    });
});

describe('findBestMove 健壮性', () => {
    it('200 个随机中盘局面下三种难度都不抛异常且落点合法', () => {
        for (let seed = 1; seed <= 200; seed++) {
            const rand = seededRand(seed);
            const b = createBoard();
            // 摆 6~14 个交替棋子
            const count = 6 + Math.floor(rand() * 9);
            for (let i = 0; i < count; i++) {
                const cells = candidateCells(b);
                const pick = cells[Math.floor(rand() * cells.length)];
                if (!pick) {
                    break;
                }
                b[pick.y][pick.x] = i % 2 === 0 ? BLACK : WHITE;
            }
            for (const difficulty of ['easy', 'medium', 'hard'] as const) {
                const move = findBestMove(b, BLACK, WHITE, difficulty, rand);
                expect(move).not.toBeNull();
                expect(b[move!.y][move!.x]).toBe(EMPTY);
            }
        }
    });

    it('满盘返回 null', () => {
        const b = createBoard();
        for (let y = 0; y < 15; y++) {
            for (let x = 0; x < 15; x++) {
                b[y][x] = (x + y) % 2 === 0 ? BLACK : WHITE;
            }
        }
        expect(findBestMove(b, BLACK, WHITE, 'hard', () => 0.5)).toBeNull();
    });
});
