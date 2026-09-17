/**
 * 五子棋纯逻辑（棋盘与 AI，不碰 DOM，无 Vue 依赖），由旧版 webviewContent.ts 的
 * GOMOKU IIFE 逐行移植。规则：15×15 棋盘，任意方向连成五子即胜（长连也算）。
 * rand 参数可注入（缺省 Math.random，行为与旧版一致），测试用。
 */

export const SIZE = 15;
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export type Difficulty = 'easy' | 'medium' | 'hard';
export type Board = number[][];
export interface Point {
    x: number;
    y: number;
}

/* 各棋型的分值。WIN 是立即成五；OPEN_FOUR 是活四（堵一头走另一头成五，
   两步内必赢），单独一档压过其余所有棋型；再往下逐级递减。 */
const SCORES = {
    WIN: 100000000,
    OPEN_FOUR: 10000000,
    CLOSED_FOUR: 10000,
    OPEN_THREE: 8000,
    CLOSED_THREE: 500,
    OPEN_TWO: 200,
    CLOSED_TWO: 20,
    OPEN_ONE: 10
};

export function createBoard(): Board {
    const board: Board = [];
    for (let y = 0; y < SIZE; y++) {
        const row: number[] = [];
        for (let x = 0; x < SIZE; x++) {
            row.push(EMPTY);
        }
        board.push(row);
    }
    return board;
}

function inBoard(x: number, y: number): boolean {
    return x >= 0 && x < SIZE && y >= 0 && y < SIZE;
}

/* 沿 (dx,dy) 方向数连子。调用方保证 (x,y) 处假设已经落 color。 */
export function countRun(
    board: Board,
    x: number,
    y: number,
    dx: number,
    dy: number,
    color: number
): { run: number; open: number; startX: number; startY: number } {
    let run = 1;
    let open = 0;
    let startX = x;
    let startY = y;
    let nx = x + dx;
    let ny = y + dy;
    while (inBoard(nx, ny) && board[ny][nx] === color) {
        run++;
        nx += dx;
        ny += dy;
    }
    if (inBoard(nx, ny) && board[ny][nx] === EMPTY) {
        open++;
    }
    nx = x - dx;
    ny = y - dy;
    while (inBoard(nx, ny) && board[ny][nx] === color) {
        run++;
        startX = nx;
        startY = ny;
        nx -= dx;
        ny -= dy;
    }
    if (inBoard(nx, ny) && board[ny][nx] === EMPTY) {
        open++;
    }
    return { run, open, startX, startY };
}

/* 检查 (x,y) 落 color 后是否成五（棋盘上 (x,y) 已落下这手）。成五返回五子坐标用于高亮。 */
export function checkWin(board: Board, x: number, y: number, color: number): Point[] | null {
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (const [dx, dy] of dirs) {
        const r = countRun(board, x, y, dx, dy, color);
        if (r.run >= 5) {
            const line: Point[] = [];
            for (let k = 0; k < 5; k++) {
                line.push({ x: r.startX + dx * k, y: r.startY + dy * k });
            }
            return line;
        }
    }
    return null;
}

function scoreRun(run: number, open: number): number {
    if (run >= 5) return SCORES.WIN;
    if (run === 4) return open === 2 ? SCORES.OPEN_FOUR : open === 1 ? SCORES.CLOSED_FOUR : 0;
    if (run === 3) return open === 2 ? SCORES.OPEN_THREE : open === 1 ? SCORES.CLOSED_THREE : 0;
    if (run === 2) return open === 2 ? SCORES.OPEN_TWO : open === 1 ? SCORES.CLOSED_TWO : 0;
    if (run === 1) return open === 2 ? SCORES.OPEN_ONE : 0;
    return 0;
}

/* 在空位 (x,y) 落 color 的静态评分：四个方向棋型分之和 + 靠近中心的小加成。 */
export function evalPoint(board: Board, x: number, y: number, color: number): number {
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    let total = 0;
    for (const [dx, dy] of dirs) {
        const r = countRun(board, x, y, dx, dy, color);
        total += scoreRun(r.run, r.open);
    }
    const center = (SIZE - 1) / 2;
    total += Math.round(7 - Math.abs(x - center) - Math.abs(y - center));
    return total;
}

/* 候选落点：已有棋子周围两格以内的空位。五子棋的威胁只会出现在已有棋子附近，
   远处空位没有价值；顺带把搜索量砍到几十个点。 */
export function candidateCells(board: Board): Point[] {
    const seen = Object.create(null) as Record<number, boolean>;
    const cells: Point[] = [];
    const add = (x: number, y: number): void => {
        if (!inBoard(x, y) || board[y][x] !== EMPTY) {
            return;
        }
        const key = y * SIZE + x;
        if (seen[key]) {
            return;
        }
        seen[key] = true;
        cells.push({ x, y });
    };
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            if (board[y][x] === EMPTY) {
                continue;
            }
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    if (dx || dy) {
                        add(x + dx, y + dy);
                    }
                }
            }
        }
    }
    const boardEmpty = !board.some((row) => row.some((cell) => cell !== EMPTY));
    if (!cells.length && boardEmpty) {
        // 空盘（AI 先手时才会遇到）：下天元。
        // 旧版这里只看 cells 是否为空，满盘时会把已被占用的天元也返回，
        // 导致平局判定失效——改成显式判空盘。
        const c = (SIZE - 1) / 2;
        cells.push({ x: c, y: c });
    }
    return cells;
}

interface RankedMove extends Point {
    attack: number;
    defense: number;
}

/* 给每个候选点算两个分：attack（AI 自己落这里的价值）、defense（对手落这里的威胁）。 */
function rankCandidates(board: Board, aiColor: number, humanColor: number): RankedMove[] {
    return candidateCells(board).map((c) => ({
        x: c.x,
        y: c.y,
        attack: evalPoint(board, c.x, c.y, aiColor),
        defense: evalPoint(board, c.x, c.y, humanColor)
    }));
}

/* AI 视角的攻防加权：进攻略高于防守，有得赢时优先赢而不是一味堵。 */
function valueOf(m: RankedMove): number {
    return m.attack + m.defense * 0.9;
}

/* 对手视角的加权：对手落子时，它的「defense」才是它的进攻。 */
function valueOfOpponent(m: RankedMove): number {
    return m.defense + m.attack * 0.9;
}

function maxBy(list: RankedMove[], fn: (m: RankedMove) => number): RankedMove {
    let best = list[0];
    for (let i = 1; i < list.length; i++) {
        if (fn(list[i]) > fn(best)) {
            best = list[i];
        }
    }
    return best;
}

export function findBestMove(
    board: Board,
    aiColor: number,
    humanColor: number,
    difficulty: Difficulty,
    rand: () => number = Math.random
): Point | null {
    const ranked = rankCandidates(board, aiColor, humanColor);
    if (!ranked.length) {
        return null;
    }

    /* 1. 自己能立即成五 → 直接赢。 */
    const fives = ranked.filter((m) => m.attack >= SCORES.WIN);
    if (fives.length) {
        return maxBy(fives, valueOf);
    }

    /* 2. 对方一步成五 → 必须堵。对方的五比自己的活四快，先堵。 */
    const blockFives = ranked.filter((m) => m.defense >= SCORES.WIN);
    if (blockFives.length) {
        return maxBy(blockFives, valueOf);
    }

    /* 3. 自己能成活四 → 直接走。堵一头我走另一头成五，两步内必赢。 */
    const fours = ranked.filter((m) => m.attack >= SCORES.OPEN_FOUR);
    if (fours.length) {
        return maxBy(fours, valueOf);
    }

    /* 4. 对方要成活四 → 必须堵（不堵就是我输）。 */
    const blockFours = ranked.filter((m) => m.defense >= SCORES.OPEN_FOUR);
    if (blockFours.length) {
        return maxBy(blockFours, valueOf);
    }

    /* 以上四步三个难度都做——再简单的对手也得会收棋和堵必死点，
       难度差异体现在下面的打分环节。 */

    if (difficulty === 'easy') {
        /* 简单：进攻分打折、偏防守，且在得分前三的落点里随机。 */
        const sortedEasy = ranked.slice().sort(
            (a, b) => b.attack * 0.5 + b.defense * 0.9 - (a.attack * 0.5 + a.defense * 0.9)
        );
        const topEasy = sortedEasy.slice(0, Math.min(3, sortedEasy.length));
        return topEasy[Math.floor(rand() * topEasy.length)];
    }

    if (difficulty === 'medium') {
        /* 中等：攻防加权，在与最高分接近（2% 以内）的一批落点里随机，避免每局走法雷同。 */
        const maxVal = ranked.reduce((acc, m) => Math.max(acc, valueOf(m)), -Infinity);
        const ties = ranked.filter((m) => valueOf(m) >= maxVal * 0.98);
        return ties[Math.floor(rand() * ties.length)];
    }

    /* 困难：往前看一层。我落子后，模拟对方的最强反击，选「我的收益 - 对方反击威胁」最大的点。 */
    const candidates = ranked.slice().sort((a, b) => valueOf(b) - valueOf(a)).slice(0, 10);
    let bestMove: Point | null = null;
    let bestValue = -Infinity;
    for (const c of candidates) {
        board[c.y][c.x] = aiColor;
        const replies = rankCandidates(board, aiColor, humanColor);
        let replyValue = 0;
        if (replies.length) {
            replyValue = valueOfOpponent(maxBy(replies, valueOfOpponent));
        }
        board[c.y][c.x] = EMPTY;
        const value = valueOf(c) - replyValue * 0.9;
        if (value > bestValue) {
            bestValue = value;
            bestMove = c;
        }
    }
    return bestMove;
}
