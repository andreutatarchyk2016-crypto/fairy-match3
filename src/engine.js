import { TILE_TYPES, BOARD_SHAPES } from "./data.js?v=34";

const SIZE = 8;
const TYPES = TILE_TYPES.length;

function randType() {
  return Math.floor(Math.random() * TYPES);
}

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function createBoard(mask) {
  // Create board avoiding initial matches where possible; -2 = void
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (mask && !mask[r][c]) { board[r][c] = -2; continue; }
      let type = randType();
      let guard = 0;
      while (guard++ < 20 && createsInitialMatch(board, r, c, type, mask)) {
        type = randType();
      }
      board[r][c] = type;
    }
  }
  return board;
}

function createsInitialMatch(board, r, c, type, mask) {
  const ok = (rr, cc) => rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && (!mask || mask[rr][cc]) && board[rr][cc] === type;
  // horizontal
  if (ok(r, c - 1) && ok(r, c - 2)) return true;
  // vertical
  if (ok(r - 1, c) && ok(r - 2, c)) return true;
  return false;
}

function isVined(vines, r, c) {
  return vines && vines.has(r + "," + c);
}

function findMatches(board, vines) {
  const marked = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  let any = false;

  // horizontal runs
  for (let r = 0; r < SIZE; r++) {
    let c = 0;
    while (c < SIZE) {
      const t = board[r][c];
      if (t < 0 || isVined(vines, r, c)) { c++; continue; }
      let end = c + 1;
      while (end < SIZE && board[r][end] === t && !isVined(vines, r, end)) end++;
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
      if (t < 0 || isVined(vines, r, c)) { r++; continue; }
      let end = r + 1;
      while (end < SIZE && board[end][c] === t && !isVined(vines, end, c)) end++;
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
    this.mask = BOARD_SHAPES[this.level.shape] || BOARD_SHAPES.full;
    this.vines = new Set((this.level.vines || []).map(p => p.r + "," + p.c));
    this.vinesCleared = 0;
    this.board = createBoard(this.mask);
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
      const { marked, any } = findMatches(this.board, this.vines);
      if (!any) break;
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (marked[r][c]) this.board[r][c] = randType();
      // recheck - easier to just regenerate colliding cells; but may loop. fallback: regenerate board
    }
    // hard guarantee
    let guard = 0;
    while (findMatches(this.board, this.vines).any && guard++ < 50) {
      this.board = createBoard(this.mask);
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
    if (this.board[a.r][a.c] < 0 || this.board[b.r][b.c] < 0) return false;
    if (this.vines?.has(a.r + "," + a.c) || this.vines?.has(b.r + "," + b.c)) return false;
    return true;
  }

  async trySwap(a, b) {
    if (!this.canSwap(a, b)) return { swapped: false };
    this.busy = true;
    this.swapCells(a, b);
    await this.cb.onSwap?.(a, b, cloneBoard(this.board));

    const { any } = findMatches(this.board, this.vines);
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

  clearVinesByMarked(marked) {
    if (!this.vines || this.vines.size === 0) return 0;
    const toClear = [];
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      if (!marked[r][c]) continue;
      for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nr = r + dr, nc = c + dc;
        const k = nr + "," + nc;
        if (this.vines.has(k)) toClear.push(k);
      }
    }
    let cleared = 0;
    for (const k of toClear) {
      if (this.vines.delete(k)) { this.vinesCleared++; cleared++; }
    }
    return cleared;
  }

  async resolveCascades() {
    while (true) {
      const { marked, any } = findMatches(this.board, this.vines);
      if (!any) break;
      this.combo += 1;
      const cleared = countMarked(marked);
      const types = collectMarkedTypes(this.board, marked);
      for (const [t, n] of Object.entries(types)) {
        const k = Number(t);
        this.collected[k] = (this.collected[k] || 0) + n;
      }
      let gain = cleared * 10 * this.combo + Math.max(0, cleared - 3) * 15;
      const vinesCleared = this.clearVinesByMarked(marked);
      if (vinesCleared > 0) gain += vinesCleared * 30;
      this.score += gain;
      this.cb.onMatch?.({ marked: marked.map(r => r.slice()), cleared, combo: this.combo, gain, collected: { ...this.collected }, score: this.score, vinesCleared });

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
        const v = this.board[r][c];
        if (v === -2) {
          // fill the segment below this void
          for (let rr = write; rr > r; rr--) {
            if (this.board[rr][c] === -2) break;
            const type = randType();
            this.board[rr][c] = type;
            movements.push({ fromR: -1 - (write - rr), fromC: c, toR: rr, toC: c, type, isNew: true });
          }
          write = r - 1;
          continue;
        }
        if (v >= 0) {
          if (write !== r) {
            this.board[write][c] = v;
            movements.push({ fromR: r, fromC: c, toR: write, toC: c, type: v, isNew: false });
            this.board[r][c] = -1;
          }
          write--;
        }
      }
      // fill remaining top segment
      for (let rr = write; rr >= 0; rr--) {
        if (this.board[rr][c] === -2) break;
        const type = randType();
        this.board[rr][c] = type;
        movements.push({ fromR: -1 - (write - rr), fromC: c, toR: rr, toC: c, type, isNew: true });
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
    if (g.type === "vines") {
      const current = this.vinesCleared || 0;
      return { current, target: g.target, done: current >= g.target, text: `Освободить фишки от лозы: ${g.target}` };
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
    if (this.movesLeft <= 0) {
      this.over = true;
      this.won = goal.done;
    }
  }

  async activateHammer(r, c) {
    if (this.busy || this.over) return false;
    if (!this.inBounds(r, c) || this.board[r][c] < 0) return false;
    this.busy = true;
    const key = r + "," + c;
    let gain = 0;
    if (this.vines?.has(key)) {
      this.vines.delete(key);
      this.vinesCleared++;
      gain += 30;
    }
    const t = this.board[r][c];
    if (t >= 0) {
      this.collected[t] = (this.collected[t] || 0) + 1;
      gain += 20;
    }
    this.score += gain;
    this.board[r][c] = -1;
    this.cb.onMatch?.({ marked: Array.from({ length: SIZE }, (_, rr) => Array.from({ length: SIZE }, (_, cc) => rr === r && cc === c)), cleared: t >= 0 ? 1 : 0, combo: 0, gain, collected: { ...this.collected }, score: this.score });
    await delay(200);
    this.cb.onClear?.(cloneBoard(this.board));
    await delay(120);
    const movements = this.applyGravityAndRefill();
    this.cb.onRefill?.(cloneBoard(this.board), movements);
    await delay(280);
    await this.resolveCascades();
    this.checkEnd();
    this.busy = false;
    this.cb.onState?.(this.snapshot());
    return true;
  }

  async activateBomb(r, c) {
    if (this.busy || this.over) return false;
    if (!this.inBounds(r, c)) return false;
    this.busy = true;
    let clearedAny = false;
    let cleared = 0;
    let vinesCleared = 0;
    const marked = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const nr = r + dr, nc = c + dc;
      if (!this.inBounds(nr, nc)) continue;
      const vk = nr + "," + nc;
      if (this.vines?.has(vk)) { this.vines.delete(vk); this.vinesCleared++; vinesCleared++; clearedAny = true; }
      const t = this.board[nr][nc];
      if (t >= 0) {
        this.collected[t] = (this.collected[t] || 0) + 1;
        this.board[nr][nc] = -1;
        marked[nr][nc] = true;
        clearedAny = true;
        cleared++;
      }
    }
    if (!clearedAny) { this.busy = false; return false; }
    const gain = cleared * 20 + vinesCleared * 30;
    this.score += gain;
    this.cb.onMatch?.({ marked, cleared, combo: 0, gain, collected: { ...this.collected }, score: this.score, vinesCleared });
    await delay(220);
    this.cb.onClear?.(cloneBoard(this.board));
    await delay(120);
    const movements = this.applyGravityAndRefill();
    this.cb.onRefill?.(cloneBoard(this.board), movements);
    await delay(280);
    await this.resolveCascades();
    this.checkEnd();
    this.busy = false;
    this.cb.onState?.(this.snapshot());
    return true;
  }

  async shuffleBoard() {
    if (this.busy || this.over) return false;
    this.busy = true;
    const cells = [];
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      if (this.board[r][c] >= 0 && !this.vines?.has(r + "," + c)) cells.push({r,c});
    }
    const types = cells.map(p => this.board[p.r][p.c]);
    for (let i = types.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [types[i],types[j]]=[types[j],types[i]]; }
    cells.forEach((p, i) => { this.board[p.r][p.c] = types[i]; });
    // avoid deadboard/no-match-stuck is ok; but avoid immediate matches? not necessary
    this.resolveInitial();
    this.cb.onRefill?.(cloneBoard(this.board), []);
    await delay(200);
    this.busy = false;
    this.cb.onState?.(this.snapshot());
    return true;
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