import { TILE_TYPES } from "./data.js";

const SIZE = 8;
const TYPES = TILE_TYPES.length;

function randType() {
  return Math.floor(Math.random() * TYPES);
}

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function createBoard() {
  // Create board avoiding initial matches where possible
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      let type = randType();
      let guard = 0;
      while (guard++ < 20 && createsInitialMatch(board, r, c, type)) {
        type = randType();
      }
      board[r][c] = type;
    }
  }
  return board;
}

function createsInitialMatch(board, r, c, type) {
  // horizontal
  if (c >= 2 && board[r][c - 1] === type && board[r][c - 2] === type) return true;
  // vertical
  if (r >= 2 && board[r - 1][c] === type && board[r - 2][c] === type) return true;
  return false;
}

function findMatches(board) {
  const marked = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  let any = false;

  // horizontal runs
  for (let r = 0; r < SIZE; r++) {
    let c = 0;
    while (c < SIZE) {
      const t = board[r][c];
      if (t < 0) { c++; continue; }
      let end = c + 1;
      while (end < SIZE && board[r][end] === t) end++;
      if (end - c >= 3) {
        for (let k = c; k < end; k++) marked[r][k] = true;
        any = true;
      }
      c = end;
    }
  }
  // vertical runs
  for (let c = 0; c < SIZE; c++) {
    let r = 0;
    while (r < SIZE) {
      const t = board[r][c];
      if (t < 0) { r++; continue; }
      let end = r + 1;
      while (end < SIZE && board[end][c] === t) end++;
      if (end - r >= 3) {
        for (let k = r; k < end; k++) marked[k][c] = true;
        any = true;
      }
      r = end;
    }
  }

  return { marked, any };
}

function countMarked(marked) {
  let n = 0;
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (marked[r][c]) n++;
  return n;
}

function collectMarkedTypes(board, marked) {
  const counts = {};
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!marked[r][c]) continue;
      const t = board[r][c];
      counts[t] = (counts[t] || 0) + 1;
    }
  }
  return counts;
}

export class GameEngine {
  constructor(level, callbacks = {}) {
    this.level = level;
    this.cb = callbacks;
    this.size = SIZE;
    this.reset();
  }

  reset() {
    this.board = createBoard();
    // Ensure no immediate matches (our generator tries, but be safe)
    this.resolveInitial();
    this.score = 0;
    this.movesLeft = this.level.moves;
    this.collected = {}; // tileType -> count
    this.combo = 0;
    this.busy = false;
    this.over = false;
    this.won = false;
  }

  resolveInitial() {
    // silently clear any initial matches without scoring
    for (let i = 0; i < 20; i++) {
      const { marked, any } = findMatches(this.board);
      if (!any) break;
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (marked[r][c]) this.board[r][c] = randType();
      // recheck - easier to just regenerate colliding cells; but may loop. fallback: regenerate board
    }
    // hard guarantee
    let guard = 0;
    while (findMatches(this.board).any && guard++ < 50) {
      this.board = createBoard();
    }
  }

  inBounds(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }

  isAdjacent(a, b) {
    return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
  }

  canSwap(a, b) {
    if (this.busy || this.over) return false;
    if (!this.inBounds(a.r, a.c) || !this.inBounds(b.r, b.c)) return false;
    if (!this.isAdjacent(a, b)) return false;
    return true;
  }

  async trySwap(a, b) {
    if (!this.canSwap(a, b)) return { swapped: false };
    this.busy = true;
    this.swapCells(a, b);
    await this.cb.onSwap?.(a, b, cloneBoard(this.board));

    const { any } = findMatches(this.board);
    if (!any) {
      await delay(120);
      this.swapCells(a, b);
      await this.cb.onSwapBack?.(a, b, cloneBoard(this.board));
      this.busy = false;
      return { swapped: false };
    }

    this.movesLeft -= 1;
    this.combo = 0;
    this.cb.onMove?.(this.snapshot());

    await this.resolveCascades();

    this.checkEnd();
    this.busy = false;
    this.cb.onState?.(this.snapshot());
    return { swapped: true };
  }

  swapCells(a, b) {
    const t = this.board[a.r][a.c];
    this.board[a.r][a.c] = this.board[b.r][b.c];
    this.board[b.r][b.c] = t;
  }

  async resolveCascades() {
    while (true) {
      const { marked, any } = findMatches(this.board);
      if (!any) break;
      this.combo += 1;
      const cleared = countMarked(marked);
      const types = collectMarkedTypes(this.board, marked);
      for (const [t, n] of Object.entries(types)) {
        const k = Number(t);
        this.collected[k] = (this.collected[k] || 0) + n;
      }
      const gain = cleared * 10 * this.combo + Math.max(0, cleared - 3) * 15;
      this.score += gain;
      this.cb.onMatch?.({ marked: marked.map(r => r.slice()), cleared, combo: this.combo, gain, collected: { ...this.collected }, score: this.score });

      await delay(260);

      // clear
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (marked[r][c]) this.board[r][c] = -1;
      this.cb.onClear?.(cloneBoard(this.board));

      await delay(120);

      // gravity + refill
      const movements = this.applyGravityAndRefill();
      this.cb.onRefill?.(cloneBoard(this.board), movements);
      await delay(280);
    }
  }

  applyGravityAndRefill() {
    const movements = []; // {fromR, fromC, toR, toC, type, new}
    for (let c = 0; c < SIZE; c++) {
      let write = SIZE - 1;
      for (let r = SIZE - 1; r >= 0; r--) {
        if (this.board[r][c] >= 0) {
          if (write !== r) {
            this.board[write][c] = this.board[r][c];
            movements.push({ fromR: r, fromC: c, toR: write, toC: c, type: this.board[write][c], isNew: false });
            this.board[r][c] = -1;
          }
          write--;
        }
      }
      for (let r = write; r >= 0; r--) {
        const type = randType();
        this.board[r][c] = type;
        movements.push({ fromR: -1 - (write - r), fromC: c, toR: r, toC: c, type, isNew: true });
      }
    }
    return movements;
  }

  goalProgress() {
    const g = this.level.goal;
    if (g.type === "score") {
      return { current: this.score, target: g.target, done: this.score >= g.target, text: `Набрать ${g.target} очков` };
    }
    if (g.type === "collect") {
      const current = this.collected[g.tile] || 0;
      const tile = TILE_TYPES[g.tile];
      return { current, target: g.target, done: current >= g.target, text: `Собрать ${tile.gem} ${tile.name}: ${g.target}` };
    }
    return { current: 0, target: 1, done: false, text: "Цель" };
  }

  starsForScore(score) {
    const [s1, s2, s3] = this.level.starThresholds;
    if (score >= s3) return 3;
    if (score >= s2) return 2;
    if (score >= s1) return 1;
    return 0;
  }

  checkEnd() {
    const goal = this.goalProgress();
    if (goal.done) {
      this.won = true;
      this.over = true;
      return;
    }
    if (this.movesLeft <= 0) {
      this.over = true;
      this.won = false;
    }
  }

  snapshot() {
    const goal = this.goalProgress();
    return {
      board: cloneBoard(this.board),
      score: this.score,
      movesLeft: this.movesLeft,
      collected: { ...this.collected },
      goal,
      stars: this.starsForScore(this.score),
      over: this.over,
      won: this.won,
      combo: this.combo,
    };
  }
}

function delay(ms) { return new Promise((res) => setTimeout(res, ms)); }

export { SIZE };