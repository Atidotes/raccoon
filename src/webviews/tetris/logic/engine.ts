/**
 * 俄罗斯方块纯逻辑（不碰 DOM，无 Vue 依赖），由旧版 webviewContent.ts 的 IIFE
 * 机械搬运而来。旧代码是字节级恢复的，函数名、结构、顺序全部保留，只做了
 * 三件事：变量收进 game 对象、函数加首参 g、DOM 依赖（updateHUD / showOverlay /
 * hideOverlay / drawNext）改为由 UI 侧承担。行为差异一律视为 bug，用测试钉死。
 */

export type PieceType = 'I' | 'J' | 'L' | 'O' | 'S' | 'T' | 'Z';
export type Phase = 'ready' | 'playing' | 'paused' | 'over';

export interface Piece {
    type: PieceType;
    matrix: number[][];
    x: number;
    y: number;
}

export interface TetrisGame {
    board: (PieceType | null)[][];
    current: Piece | null;
    nextPiece: Piece | null;
    bag: PieceType[];
    score: number;
    lines: number;
    level: number;
    dropInterval: number;
    dropCounter: number;
    lastTime: number;
    phase: Phase; // 旧代码的 var state，改名避免和 UI 的 state 混淆
    /** 游戏结束回调：UI 侧负责 best 判断、遮罩与 postMessage */
    onGameOver?: (score: number, lines: number) => void;
    /** 随机源，测试注入；缺省 Math.random */
    rand: () => number;
}

export const COLS = 10;
export const ROWS = 20;
export const CELL = 26;
export const BOARD_W = COLS * CELL;
export const BOARD_H = ROWS * CELL;

export const SHAPES: Record<PieceType, number[][]> = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
    O: [[1, 1], [1, 1]],
    S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]]
};

export const COLORS: Record<PieceType, string> = {
    I: '#22d3ee',
    J: '#60a5fa',
    L: '#fb923c',
    O: '#facc15',
    S: '#4ade80',
    T: '#c084fc',
    Z: '#f87171'
};

export const TYPES: PieceType[] = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
export const LINE_SCORES = [0, 100, 300, 500, 800];
export const BASE_INTERVAL = 800;
export const MIN_INTERVAL = 80;

export function createGame(rand: () => number = Math.random): TetrisGame {
    return {
        board: createBoard(),
        current: null,
        nextPiece: null,
        bag: [],
        score: 0,
        lines: 0,
        level: 1,
        dropInterval: BASE_INTERVAL,
        dropCounter: 0,
        lastTime: 0,
        phase: 'ready',
        rand
    };
}

export function createBoard(): (PieceType | null)[][] {
    const b: (PieceType | null)[][] = [];
    for (let r = 0; r < ROWS; r++) {
        b.push(new Array(COLS).fill(null));
    }
    return b;
}

export function pickType(g: TetrisGame): PieceType {
    if (g.bag.length === 0) {
        g.bag = TYPES.slice();
        for (let i = g.bag.length - 1; i > 0; i--) {
            const j = Math.floor(g.rand() * (i + 1));
            const tmp = g.bag[i];
            g.bag[i] = g.bag[j];
            g.bag[j] = tmp;
        }
    }
    return g.bag.pop() as PieceType;
}

export function makePiece(type: PieceType): Piece {
    const shape = SHAPES[type];
    const m = shape.map((row) => row.slice());

    let firstRow = 0;
    for (let r = 0; r < m.length; r++) {
        let hasBlock = false;
        for (let c = 0; c < m[r].length; c++) {
            if (m[r][c]) {
                hasBlock = true;
                break;
            }
        }
        if (hasBlock) {
            firstRow = r;
            break;
        }
    }

    return {
        type,
        matrix: m,
        x: Math.floor((COLS - m[0].length) / 2),
        // -firstRow 在 firstRow=0 时是 -0，行为与 0 无异但会污染断言，归一化掉
        y: -firstRow || 0
    };
}

/* ============ 碰撞 ============ */
export function collides(piece: Piece, grid: (PieceType | null)[][]): boolean {
    const m = piece.matrix;
    for (let r = 0; r < m.length; r++) {
        for (let c = 0; c < m[r].length; c++) {
            if (!m[r][c]) {
                continue;
            }

            const x = piece.x + c;
            const y = piece.y + r;

            if (x < 0 || x >= COLS || y >= ROWS) {
                return true;
            }
            if (y >= 0 && grid[y][x]) {
                return true;
            }
        }
    }
    return false;
}

/* ============ 旋转 ============ */
export function rotateMatrix(m: number[][], dir: number): number[][] {
    const n = m.length;
    const out: number[][] = [];

    for (let r = 0; r < n; r++) {
        const row: number[] = [];
        for (let c = 0; c < n; c++) {
            row.push(dir > 0 ? m[n - 1 - c][r] : m[c][n - 1 - r]);
        }
        out.push(row);
    }
    return out;
}

export function rotatePiece(g: TetrisGame, dir: number): void {
    const current = g.current;
    if (!current) {
        return;
    }
    const rotated = rotateMatrix(current.matrix, dir);
    const origMatrix = current.matrix;
    const origX = current.x;
    const kicks = [0, -1, 1, -2, 2];

    for (let i = 0; i < kicks.length; i++) {
        current.matrix = rotated;
        current.x = origX + kicks[i];
        if (!collides(current, g.board)) {
            return;
        }
    }

    current.matrix = origMatrix;
    current.x = origX;
}

/* ============ 操作 ============ */
export function moveHorizontal(g: TetrisGame, dir: number): void {
    const current = g.current;
    if (!current) {
        return;
    }
    current.x += dir;
    if (collides(current, g.board)) {
        current.x -= dir;
    }
}

export function softDrop(g: TetrisGame): void {
    const current = g.current;
    if (!current) {
        return;
    }
    current.y++;
    if (collides(current, g.board)) {
        current.y--;
        lockPiece(g);
    } else {
        g.score += 1;
    }
    g.dropCounter = 0;
}

export function hardDrop(g: TetrisGame): void {
    const current = g.current;
    if (!current) {
        return;
    }
    let dist = 0;
    while (!collides(current, g.board)) {
        current.y++;
        dist++;
    }
    current.y--;
    dist--;

    if (dist > 0) {
        g.score += dist * 2;
    }

    lockPiece(g);
    g.dropCounter = 0;
}

export function stepDown(g: TetrisGame): void {
    const current = g.current;
    if (!current) {
        return;
    }
    current.y++;
    if (collides(current, g.board)) {
        current.y--;
        lockPiece(g);
    }
}

/* ============ 锁定 / 消行 ============ */
export function lockPiece(g: TetrisGame): void {
    const current = g.current;
    if (!current) {
        return;
    }
    const m = current.matrix;

    for (let r = 0; r < m.length; r++) {
        for (let c = 0; c < m[r].length; c++) {
            if (!m[r][c]) {
                continue;
            }

            const x = current.x + c;
            const y = current.y + r;

            if (y >= 0 && y < ROWS && x >= 0 && x < COLS) {
                g.board[y][x] = current.type;
            }
        }
    }

    clearLines(g);
    spawnPiece(g);
}

export function clearLines(g: TetrisGame): void {
    let cleared = 0;

    for (let r = ROWS - 1; r >= 0; r--) {
        let full = true;
        for (let c = 0; c < COLS; c++) {
            if (!g.board[r][c]) {
                full = false;
                break;
            }
        }

        if (full) {
            g.board.splice(r, 1);
            g.board.unshift(new Array(COLS).fill(null));
            cleared++;
            r++;
        }
    }

    if (cleared > 0) {
        g.score += LINE_SCORES[cleared] * g.level;
        g.lines += cleared;

        const newLevel = Math.floor(g.lines / 10) + 1;
        if (newLevel !== g.level) {
            g.level = newLevel;
            g.dropInterval = Math.max(MIN_INTERVAL, BASE_INTERVAL - (g.level - 1) * 70);
        }
    }
}

/* ============ 生成 / 结束 ============ */
export function spawnPiece(g: TetrisGame): void {
    g.current = g.nextPiece;
    g.nextPiece = makePiece(pickType(g));
    g.dropCounter = 0;

    if (g.current && collides(g.current, g.board)) {
        endGame(g);
    }
}

export function startGame(g: TetrisGame): void {
    g.board = createBoard();
    g.bag = [];

    g.score = 0;
    g.lines = 0;
    g.level = 1;
    g.dropInterval = BASE_INTERVAL;
    g.dropCounter = 0;
    g.lastTime = 0;

    g.current = null;
    g.nextPiece = makePiece(pickType(g));

    // 与旧代码同序：先 spawn 再置 playing。startGame 总是清空棋盘，
    // 这一步的 spawn 不可能碰撞，endGame 只会从 lockPiece → spawnPiece 的路径触发。
    spawnPiece(g);
    g.phase = 'playing';
}

export function endGame(g: TetrisGame): void {
    g.phase = 'over';
    g.onGameOver?.(g.score, g.lines);
}

/* ============ 主循环步进 ============ */
/** 旧 loop() 里的步进部分。delta 截断到 100ms，只在 playing 时落子。 */
export function tick(g: TetrisGame, delta: number): void {
    if (delta > 100) {
        delta = 100;
    }

    if (g.phase === 'playing') {
        g.dropCounter += delta;
        if (g.dropCounter > g.dropInterval) {
            g.dropCounter = 0;
            stepDown(g);
        }
    }
}
