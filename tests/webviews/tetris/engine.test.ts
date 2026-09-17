/**
 * 俄罗斯方块引擎测试。旧代码是字节级恢复的，这里把行为 quirk 逐条钉死，
 * 保证移植（以及将来的任何改动）不会悄悄改变手感。
 */
import { describe, expect, it } from 'vitest';
import {
    BASE_INTERVAL,
    LINE_SCORES,
    MIN_INTERVAL,
    PieceType,
    SHAPES,
    TYPES,
    TetrisGame,
    collides,
    createGame,
    endGame,
    hardDrop,
    lockPiece,
    makePiece,
    moveHorizontal,
    pickType,
    rotateMatrix,
    rotatePiece,
    softDrop,
    spawnPiece,
    startGame,
    stepDown,
    tick
} from '../../../src/webviews/tetris/logic/engine';

/** 固定随机：rand=0 让 7-bag 洗牌可复现（j 恒为 0）。 */
const zeroRand = () => 0;

function mkGame(): TetrisGame {
    return createGame(zeroRand);
}

/** 把 current 摆到指定位置（绕过 spawn 逻辑）。 */
function putPiece(g: TetrisGame, type: PieceType, x: number, y: number): void {
    g.current = makePiece(type);
    g.current.x = x;
    g.current.y = y;
    g.nextPiece = makePiece('I'); // 真实对局里 nextPiece 总是有值，lock 后 spawn 才有 current
}

/** 填满一行。 */
function fillRow(g: TetrisGame, r: number, skipCol?: number): void {
    for (let c = 0; c < 10; c++) {
        if (c !== skipCol) {
            g.board[r][c] = 'Z';
        }
    }
}

describe('常量', () => {
    it('消行计分表 [0,100,300,500,800]', () => {
        expect(LINE_SCORES).toEqual([0, 100, 300, 500, 800]);
    });

    it('间隔 800ms 起步、80ms 封顶', () => {
        expect(BASE_INTERVAL).toBe(800);
        expect(MIN_INTERVAL).toBe(80);
    });
});

describe('makePiece 出生位置', () => {
    it('T 件 x=3（floor 取整）y=0', () => {
        const p = makePiece('T');
        expect(p.x).toBe(3);
        expect(p.y).toBe(0);
    });

    it('I 件 y=-1（首行全空），其余件 y=0', () => {
        expect(makePiece('I').y).toBe(-1);
        for (const t of ['J', 'L', 'S', 'Z'] as const) {
            expect(makePiece(t).y).toBe(0);
        }
    });

    it('O 件 x=4（2 宽居中）', () => {
        expect(makePiece('O').x).toBe(4);
    });
});

describe('旋转矩阵', () => {
    it('全部 7 件：转 4 次回到原形', () => {
        for (const type of TYPES) {
            let m = SHAPES[type].map((row) => row.slice());
            for (let i = 0; i < 4; i++) {
                m = rotateMatrix(m, 1);
            }
            expect(m).toEqual(SHAPES[type]);
        }
    });

    it('顺时针是逆时针的逆', () => {
        for (const type of TYPES) {
            const m = SHAPES[type].map((row) => row.slice());
            expect(rotateMatrix(rotateMatrix(m, 1), -1)).toEqual(m);
        }
    });

    it('I 件竖直形态精确断言（防字节级差异）', () => {
        const vert = rotateMatrix(SHAPES.I, 1);
        expect(vert).toEqual([
            [0, 0, 1, 0],
            [0, 0, 1, 0],
            [0, 0, 1, 0],
            [0, 0, 1, 0]
        ]);
    });
});

describe('collides', () => {
    it('左右边界与底部', () => {
        const g = mkGame();
        const p = makePiece('T');
        p.x = -1;
        expect(collides(p, g.board)).toBe(true);
        p.x = 8; // T 宽 3，x=8 占 8,9,10
        expect(collides(p, g.board)).toBe(true);
        p.x = 3;
        p.y = 19; // 占 19,20 → 越界
        expect(collides(p, g.board)).toBe(true);
        p.y = 18; // 只占 18,19 → 不越界
        expect(collides(p, g.board)).toBe(false);
    });

    it('堆叠格', () => {
        const g = mkGame();
        g.board[5][4] = 'Z';
        putPiece(g, 'T', 3, 5); // T 占 (3..5, 5..7) 附近
        expect(collides(g.current!, g.board)).toBe(true);
    });

    it('出生区 y<0 不算撞', () => {
        const g = mkGame();
        putPiece(g, 'I', 3, -1); // I 首行空，实块在 y=0
        expect(collides(g.current!, g.board)).toBe(false);
    });
});

describe('rotatePiece 踢墙', () => {
    it('贴右墙时向左踢一格成功', () => {
        const g = mkGame();
        putPiece(g, 'T', 8, 5); // 旋转后占 8,9,10 → 越界，踢到 x=7
        rotatePiece(g, 1);
        expect(g.current!.x).toBe(7);
        expect(collides(g.current!, g.board)).toBe(false);
    });

    it('所有踢墙位置都撞时恢复原 matrix 和 x', () => {
        const g = mkGame();
        // T 旋转后占 (x+k+1, y+2)（x+k 取 1..5），填满 row 6 的 cols 1-7，
        // 五个 kick 偏移（0,-1,1,-2,2）全部碰撞；未旋转的 T 只占 rows 4,5，不撞
        for (let c = 1; c <= 7; c++) {
            g.board[6][c] = 'Z';
        }
        putPiece(g, 'T', 3, 4);
        const origMatrix = JSON.stringify(g.current!.matrix);
        rotatePiece(g, 1);
        expect(JSON.stringify(g.current!.matrix)).toBe(origMatrix);
        expect(g.current!.x).toBe(3);
    });
});

describe('操作', () => {
    it('moveHorizontal 贴墙不动', () => {
        const g = mkGame();
        putPiece(g, 'T', 0, 5);
        moveHorizontal(g, -1);
        expect(g.current!.x).toBe(0);
        moveHorizontal(g, 1);
        expect(g.current!.x).toBe(1);
    });

    it('softDrop 成功 +1 分并清零 dropCounter', () => {
        const g = mkGame();
        putPiece(g, 'T', 3, 5);
        g.dropCounter = 500;
        softDrop(g);
        expect(g.current!.y).toBe(6);
        expect(g.score).toBe(1);
        expect(g.dropCounter).toBe(0);
    });

    it('softDrop 被挡直接 lock 不加分', () => {
        const g = mkGame();
        putPiece(g, 'T', 3, 18); // 已落底（rows 18,19）
        softDrop(g);
        expect(g.score).toBe(0);
        expect(g.board[18][4]).toBe('T');
    });

    it('hardDrop 空列落底：dist 计分（每格 2 分）', () => {
        const g = mkGame();
        putPiece(g, 'T', 3, 5);
        hardDrop(g);
        // T 从 y=5 落到 y=18（rows 18,19 是它的落底位置），dist = 18-5 = 13
        expect(g.score).toBe(13 * 2);
        expect(g.board[18][4]).toBe('T');
        expect(g.dropCounter).toBe(0);
    });

    it('hardDrop 已落底时 dist=0 不加分仍 lock+spawn', () => {
        const g = mkGame();
        putPiece(g, 'T', 3, 18);
        hardDrop(g);
        expect(g.score).toBe(0);
        expect(g.board[18][4]).toBe('T');
        expect(g.current).not.toBeNull();
    });

    it('hardDrop dist-- quirk：初始即碰撞时 dist=-1，块上移一行再 lock（字节级行为）', () => {
        const g = mkGame();
        putPiece(g, 'T', 3, 19); // 已越界（rows 19,20）
        hardDrop(g);
        expect(g.score).toBe(0);
        // 上移一行后 lock 在 y=18（占 18、19 两行）
        expect(g.board[18][4]).toBe('T');
        expect(g.board[19][4]).toBe('T');
    });

    it('stepDown 到底 lock', () => {
        const g = mkGame();
        putPiece(g, 'T', 3, 17);
        stepDown(g); // y=18
        expect(g.current!.y).toBe(18);
        stepDown(g); // 撞 → lock + spawn
        expect(g.board[18][4]).toBe('T');
    });
});

describe('消行', () => {
    function gameWithFilledRows(rows: number[]): TetrisGame {
        const g = mkGame();
        for (const r of rows) {
            fillRow(g, r);
        }
        // T 落底位置是 y=R-2（R 为最上面的满行）：stepDown 一步后撞到满行 lock
        putPiece(g, 'T', 3, Math.max(...rows) - 2);
        stepDown(g); // 撞满行 lock → clearLines
        return g;
    }

    it('1/2/3/4 行 → 100/300/500/800 × 等级', () => {
        expect(gameWithFilledRows([19]).score).toBe(100);
        expect(gameWithFilledRows([18, 19]).score).toBe(300);
        expect(gameWithFilledRows([17, 18, 19]).score).toBe(500);
        expect(gameWithFilledRows([16, 17, 18, 19]).score).toBe(800);
    });

    it('r++ 复查：连续满行全部消掉（不复查会漏掉上一行）', () => {
        const g = gameWithFilledRows([18, 19]);
        expect(g.lines).toBe(2);
        expect(g.score).toBe(300);
    });

    it('10 行升级：level=2、间隔 730ms', () => {
        const g = mkGame();
        g.lines = 9;
        fillRow(g, 18);
        fillRow(g, 19);
        putPiece(g, 'T', 3, 16);
        stepDown(g); // lock → 消 2 行 → lines=11
        expect(g.lines).toBe(11);
        expect(g.level).toBe(2);
        expect(g.dropInterval).toBe(730);
        expect(g.score).toBe(300);
    });

    it('间隔下限 80ms（level 12 起）', () => {
        const g = mkGame();
        g.lines = 118;
        fillRow(g, 19);
        putPiece(g, 'T', 3, 17);
        stepDown(g); // lock → 消 1 行 → lines=119 → level=12
        expect(g.level).toBe(12);
        expect(g.dropInterval).toBe(80);
    });
});

describe('lockPiece 裁剪', () => {
    it('只写 y>=0 的格子（出生位以上的部分丢弃）', () => {
        const g = mkGame();
        putPiece(g, 'I', 3, -1); // I 实块在 y=0..3
        lockPiece(g);
        // row -1 不存在；row 0..3 有 I
        expect(g.board[0].slice(3, 7)).toEqual(['I', 'I', 'I', 'I']);
        // 没把负数行写进去（board 长度不变）
        expect(g.board).toHaveLength(20);
    });
});

describe('7-bag', () => {
    it('7 次 pickType 恰好耗尽 7 种', () => {
        const g = mkGame();
        const picked = new Set<PieceType>();
        for (let i = 0; i < 7; i++) {
            picked.add(pickType(g));
        }
        expect(picked.size).toBe(7);
        expect([...picked].sort()).toEqual([...TYPES].sort());
    });

    it('14 次 = 每种恰好两次', () => {
        const g = mkGame();
        const counts = new Map<PieceType, number>();
        for (let i = 0; i < 14; i++) {
            const t = pickType(g);
            counts.set(t, (counts.get(t) ?? 0) + 1);
        }
        for (const t of TYPES) {
            expect(counts.get(t)).toBe(2);
        }
    });
});

describe('游戏流程', () => {
    it('startGame 全量重置并进入 playing', () => {
        const g = mkGame();
        g.score = 999;
        g.lines = 5;
        g.level = 3;
        startGame(g);
        expect(g.phase).toBe('playing');
        expect(g.score).toBe(0);
        expect(g.lines).toBe(0);
        expect(g.level).toBe(1);
        expect(g.dropInterval).toBe(BASE_INTERVAL);
        expect(g.current).not.toBeNull();
        expect(g.nextPiece).not.toBeNull();
    });

    it('spawn 即碰撞 → 立即 endGame，回调拿到 (score, lines)', () => {
        const g = mkGame();
        startGame(g);
        // 填满顶部三行：下一次 spawn（任何件）出生即撞
        for (let r = 0; r <= 2; r++) {
            fillRow(g, r);
        }
        let got: { score: number; lines: number } | null = null;
        g.onGameOver = (score, lines) => {
            got = { score, lines };
        };
        spawnPiece(g);
        expect(g.phase).toBe('over');
        expect(got).toEqual({ score: 0, lines: 0 });
    });

    it('endGame 触发回调', () => {
        const g = mkGame();
        let called = 0;
        g.onGameOver = () => called++;
        endGame(g);
        expect(g.phase).toBe('over');
        expect(called).toBe(1);
    });

    it('spawnPiece 交换 current/nextPiece', () => {
        const g = mkGame();
        startGame(g);
        const prevNext = g.nextPiece;
        spawnPiece(g);
        expect(g.current?.type).toBe(prevNext?.type);
    });
});

describe('tick（主循环步进）', () => {
    it('delta 截断到 100ms', () => {
        const g = mkGame();
        startGame(g);
        tick(g, 5000); // 只按 100 计
        expect(g.dropCounter).toBe(100);
        expect(g.current!.y).toBe(-1); // rand=0 时第一件是 I，出生 y=-1
    });

    it('严格大于才落子：恰好等于不落', () => {
        const g = mkGame();
        startGame(g);
        const y0 = g.current!.y;
        for (let i = 0; i < 8; i++) {
            tick(g, 100); // 累计到 800
        }
        expect(g.dropCounter).toBe(800);
        expect(g.current!.y).toBe(y0); // 800 > 800 为 false
        tick(g, 1); // 801 > 800 → 落
        expect(g.current!.y).toBe(y0 + 1);
        expect(g.dropCounter).toBe(0);
    });

    it('paused 不落子', () => {
        const g = mkGame();
        startGame(g);
        g.phase = 'paused';
        const y0 = g.current!.y;
        tick(g, 5000);
        expect(g.current!.y).toBe(y0);
    });

    it('stepDown 撞底 lock 后 dropCounter 归零', () => {
        const g = mkGame();
        startGame(g);
        putPiece(g, 'T', 3, 17);
        for (let i = 0; i < 8; i++) {
            tick(g, 100);
        }
        tick(g, 1); // 落一步 → y=18
        expect(g.current!.y).toBe(18);
        for (let i = 0; i < 8; i++) {
            tick(g, 100);
        }
        tick(g, 1); // 撞底 → lock
        expect(g.board[18][4]).toBe('T');
        expect(g.dropCounter).toBe(0);
    });
});
