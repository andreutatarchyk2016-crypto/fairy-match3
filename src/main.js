import { LEVELS, UPGRADES, TILE_TYPES, STORY_INTRO } from "./data.js";
import {
  loadState, saveState, totalStarsEarned, starBank, starsSpent,
  isLevelUnlocked, recordLevelResult, buildUpgrade
} from "./state.js";
import { GameEngine, SIZE } from "./engine.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const state = loadState();
let engine = null;
let selected = null; // {r,c}
let currentLevelId = null;
let endModalShown = false;

// ---------- Audio (simple beeps, no assets) ----------
let audioCtx = null;
let soundEnabled = true;
function ensureAudio() {
  if (!soundEnabled) return;
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
}
function beep(freq = 440, dur = 0.08, type = "sine", gain = 0.035) {
  if (!soundEnabled || !audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = gain;
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
  o.connect(g); g.connect(audioCtx.destination);
  o.start();
  o.stop(audioCtx.currentTime + dur);
}
function sfxSwap() { beep(520, 0.07, "sine", 0.03); }
function sfxBad() { beep(220, 0.12, "triangle", 0.03); }
function sfxMatch(combo) { beep(440 + combo * 60, 0.09, "sine", 0.035); beep(660 + combo * 60, 0.12, "sine", 0.02); }
function sfxWin() { [523,659,784,1047].forEach((f,i)=>setTimeout(()=>beep(f,0.18,"sine",0.04), i*110)); }
function sfxLose() { [330,294,262].forEach((f,i)=>setTimeout(()=>beep(f,0.2,"triangle",0.03), i*130)); }
function sfxBuy() { [660,880].forEach((f,i)=>setTimeout(()=>beep(f,0.12,"sine",0.035), i*80)); }

// ---------- Navigation ----------
function showScreen(name) {
  $$(".screen").forEach((s) => s.classList.remove("active"));
  $(`#screen-${name}`).classList.add("active");
}

$("#homeBtn").addEventListener("click", () => { showScreen("map"); renderMap(); });
$("#homeBtn").addEventListener("keydown", (e) => { if (e.key === "Enter") { showScreen("map"); renderMap(); } });
$("#backToMapBtn").addEventListener("click", () => { showScreen("map"); renderMap(); });
$("#restartBtn").addEventListener("click", () => { if (currentLevelId) startLevel(currentLevelId); });
$("#soundBtn").addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  $("#soundBtn").textContent = soundEnabled ? "🔊" : "🔇";
  if (soundEnabled) ensureAudio();
});

function nextPlayableLevel() {
  for (const level of LEVELS) {
    if (isLevelUnlocked(level.id, state)) {
      const stars = state.starsEarned[level.id] || 0;
      if (stars === 0) return level.id;
    }
  }
  return LEVELS[LEVELS.length - 1].id;
}

function showAchievementsModal() {
  ensureAudio();
  const totalStars = totalStarsEarned(state);
  const completed = LEVELS.filter((l) => (state.starsEarned[l.id] || 0) > 0).length;
  const perfect = LEVELS.filter((l) => (state.starsEarned[l.id] || 0) === 3).length;
  const built = state.upgradesBuilt.length;
  $("#confetti").innerHTML = "";
  $("#modalStars").innerHTML = "🏆";
  $("#modalTitle").textContent = "Достижения";
  $("#modalText").textContent = "Твои волшебные успехи в Сказочном Саду.";
  $("#modalReward").innerHTML = `
    <div style="display:grid;gap:10px;text-align:left;color:var(--text);font-size:.98rem">
      <div>★ Звёзд собрано: <strong style="color:var(--gold)">${totalStars}</strong></div>
      <div>🌿 Уровней пройдено: <strong>${completed}/${LEVELS.length}</strong></div>
      <div>✨ Идеальных уровней: <strong>${perfect}</strong></div>
      <div>🏡 Построек в саду: <strong>${built}/${UPGRADES.length}</strong></div>
    </div>`;
  const actions = $("#modalActions");
  actions.innerHTML = "";
  const closeBtn = document.createElement("button");
  closeBtn.className = "btn btn-primary";
  closeBtn.textContent = "Круто!";
  closeBtn.addEventListener("click", hideModal);
  actions.appendChild(closeBtn);
  $("#modal").classList.remove("hidden");
}

$("#navPlayBtn")?.addEventListener("click", () => { ensureAudio(); showLevelBrief(nextPlayableLevel()); });
$("#navForestBtn")?.addEventListener("click", () => {
  ensureAudio();
  document.querySelector(".world-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
  const bubble = $("#npcBubble");
  if (bubble) { bubble.textContent = "Это Сказочный лес! Восстанавливай сад звёздами ✨"; }
});
$("#navAchievementsBtn")?.addEventListener("click", showAchievementsModal);

// ---------- Visual FX ----------
function initSparkles() {
  const wrap = $("#bgSparkles");
  if (!wrap) return;
  wrap.innerHTML = "";
  for (let i = 0; i < 34; i++) {
    const s = document.createElement("span");
    s.className = "bg-sparkle";
    s.style.left = Math.random() * 100 + "%";
    s.style.top = (20 + Math.random() * 75) + "%";
    s.style.setProperty("--dur", (2.4 + Math.random() * 3.8).toFixed(2) + "s");
    s.style.setProperty("--drift", (6 + Math.random() * 8).toFixed(2) + "s");
    s.style.setProperty("--delay", (-Math.random() * 5).toFixed(2) + "s");
    const size = 2 + Math.random() * 5;
    s.style.width = size + "px";
    s.style.height = size + "px";
    wrap.appendChild(s);
  }
}

function spawnFloatText(text, opts = {}) {
  const layer = $("#fxLayer");
  if (!layer) return;
  const el = document.createElement("div");
  el.className = "float-text" + (opts.combo ? " combo" : "");
  el.textContent = text;
  el.style.left = (opts.x ?? 50) + "%";
  el.style.top = (opts.y ?? 45) + "%";
  layer.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

function spawnSparks(marked) {
  const layer = $("#fxLayer");
  const board = $("#board");
  if (!layer || !board || !marked) return;
  const rect = board.getBoundingClientRect();
  const cellW = rect.width / 8;
  const cellH = rect.height / 8;
  const colors = ["#ffd84a","#fff","#ff7eb8","#7ee8c7","#7cc4ff"];
  let count = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (!marked[r] || !marked[r][c]) continue;
      const cx = c * cellW + cellW / 2;
      const cy = r * cellH + cellH / 2;
      for (let i = 0; i < 3; i++) {
        if (count++ > 60) return;
        const sp = document.createElement("span");
        sp.className = "spark";
        sp.style.left = cx + "px";
        sp.style.top = cy + "px";
        sp.style.color = colors[Math.floor(Math.random()*colors.length)];
        const ang = Math.random() * Math.PI * 2;
        const dist = 18 + Math.random() * 28;
        sp.style.setProperty("--dx", Math.cos(ang)*dist + "px");
        sp.style.setProperty("--dy", Math.sin(ang)*dist + "px");
        layer.appendChild(sp);
        setTimeout(() => sp.remove(), 700);
      }
    }
  }
}

function shakeBoard() {
  const b = $("#board");
  if (!b) return;
  b.classList.remove("shake");
  void b.offsetWidth;
  b.classList.add("shake");
}

function burstConfetti() {
  const wrap = $("#confetti");
  if (!wrap) return;
  wrap.innerHTML = "";
  const colors = ["#ffd84a","#ff7eb8","#7ee8c7","#7cc4ff","#b59cff","#fff","#ff9f43"];
  for (let i = 0; i < 80; i++) {
    const p = document.createElement("span");
    p.className = "confetti-piece";
    p.style.left = Math.random() * 100 + "%";
    p.style.background = colors[Math.floor(Math.random()*colors.length)];
    p.style.setProperty("--fall", (2.2 + Math.random() * 2.4).toFixed(2) + "s");
    p.style.animationDelay = (Math.random() * 0.5).toFixed(2) + "s";
    p.style.width = (7 + Math.random() * 8) + "px";
    p.style.height = (9 + Math.random() * 10) + "px";
    p.style.opacity = String(0.75 + Math.random() * 0.25);
    wrap.appendChild(p);
  }
}

function tileEl(r, c) {
  return document.querySelector(`.tile[data-r="${r}"][data-c="${c}"]`);
}

function animateSwapTiles(a, b, duration = 220) {
  const elA = tileEl(a.r, a.c);
  const elB = tileEl(b.r, b.c);
  if (!elA || !elB) return Promise.resolve();
  const ra = elA.getBoundingClientRect();
  const rb = elB.getBoundingClientRect();
  const dx = rb.left - ra.left;
  const dy = rb.top - ra.top;
  const ease = "cubic-bezier(.2,.85,.25,1)";
  [elA, elB].forEach((el) => {
    el.style.transition = `transform ${duration}ms ${ease}`;
    el.style.zIndex = "3";
  });
  elA.style.transform = `translate(${dx}px, ${dy}px)`;
  elB.style.transform = `translate(${-dx}px, ${-dy}px)`;
  return new Promise((resolve) => {
    setTimeout(() => {
      [elA, elB].forEach((el) => {
        el.style.transition = "";
        el.style.transform = "";
        el.style.zIndex = "";
      });
      resolve();
    }, duration);
  });
}

// ---------- Map / Story ----------
function renderTopbar() {
  $("#starBank").textContent = String(starBank(state, UPGRADES));
}

function renderMap() {
  renderTopbar();
  $("#storyIntro").textContent = STORY_INTRO;
  const total = LEVELS.length;
  const completed = LEVELS.filter((l) => (state.starsEarned[l.id] || 0) > 0).length;
  const pct = Math.round((completed / total) * 100);
  $("#storyProgressFill").style.width = pct + "%";
  $("#storyProgressText").textContent = pct + "%";
  $("#levelProgressText").textContent = `${completed}/${total} уровней`;

  const map = $("#levelMap");
  map.innerHTML = "";
  for (const level of LEVELS) {
    const unlocked = isLevelUnlocked(level.id, state);
    const stars = state.starsEarned[level.id] || 0;
    const isCurrent = unlocked && stars === 0 && (level.id === 1 || (state.starsEarned[level.id - 1] || 0) > 0);
    const btn = document.createElement("button");
    btn.className = "level-node" + (unlocked ? "" : " is-locked") + (isCurrent ? " is-current" : "");
    btn.disabled = !unlocked;
    btn.innerHTML = `
      <div class="level-num">Уровень ${level.id}</div>
      <div class="level-name">${level.title}</div>
      <div class="level-stars">${[1,2,3].map(i => `<span class="${i <= stars ? "earned" : ""}">★</span>`).join("")}</div>
      ${unlocked ? "" : '<div class="level-lock">🔒</div>'}
    `;
    btn.addEventListener("click", () => { ensureAudio(); showLevelBrief(level.id); });
    map.appendChild(btn);
  }

  renderWorld();
}

function renderWorld() {
  const builtSet = new Set(state.upgradesBuilt);
  const scene = $("#worldItems");
  scene.innerHTML = "";
  for (const u of UPGRADES) {
    const el = document.createElement("div");
    el.className = "world-item" + (builtSet.has(u.id) ? " built" : "");
    el.textContent = u.icon;
    Object.assign(el.style, u.sceneStyle);
    el.title = u.name;
    scene.appendChild(el);
  }

  const builtCount = state.upgradesBuilt.length;
  const mistOpacity = Math.max(0, 0.75 - builtCount * 0.16);
  $("#worldMist").style.opacity = String(mistOpacity);

  const list = $("#upgradeList");
  list.innerHTML = "";
  const bank = starBank(state, UPGRADES);
  for (const u of UPGRADES) {
    const built = builtSet.has(u.id);
    const canBuy = !built && bank >= u.cost;
    const row = document.createElement("div");
    row.className = "upgrade" + (built ? " is-built" : "");
    row.innerHTML = `
      <div class="upgrade-icon">${u.icon}</div>
      <div>
        <div class="upgrade-name">${u.name}</div>
        <div class="upgrade-desc">${u.desc}</div>
      </div>
      <div style="text-align:right">
        <div class="upgrade-cost ${built ? "built" : ""}">${built ? "Построено" : `★ ${u.cost}`}</div>
        ${built ? "" : `<button class="btn-buy" ${canBuy ? "" : "disabled"}>${canBuy ? "Построить" : "Нужно звёзд"}</button>`}
      </div>
    `;
    const buyBtn = row.querySelector(".btn-buy");
    if (buyBtn) {
      buyBtn.addEventListener("click", () => {
        ensureAudio();
        if (buildUpgrade(state, u.id, UPGRADES)) {
          sfxBuy();
          saveState(state);
          renderMap();
        }
      });
    }
    list.appendChild(row);
  }
}

// ---------- Game ----------
function startLevel(levelId) {
  const level = LEVELS.find((l) => l.id === levelId);
  if (!level) return;
  currentLevelId = levelId;
  selected = null;
  endModalShown = false;
  hideModal();
  engine = new GameEngine(level, {
    onSwap: async (a, b) => {
      sfxSwap();
      await animateSwapTiles(a, b, 220);
      renderBoard(engine.board, []);
    },
    onSwapBack: async (a, b) => {
      sfxBad();
      await animateSwapTiles(a, b, 200);
      renderBoard(engine.board, []);
    },
    onMatch: ({ marked, combo, gain }) => {
      sfxMatch(combo);
      renderBoard(engine.board, marked);
      spawnSparks(marked);
      if (combo > 1) {
        spawnFloatText(`Комбо x${combo}!`, { x: 50, y: 42, combo: true });
        if (combo >= 3) shakeBoard();
      }
      spawnFloatText(`+${gain}`, { x: 50 + (Math.random()*18-9), y: 52 + (Math.random()*10-5) });
      updateHUD();
    },
    onClear: (board) => { renderBoard(board, []); },
    onRefill: (board, movements) => {
      const spawnSet = new Set((movements || []).map((m) => m.toR + "," + m.toC));
      renderBoard(board, [], spawnSet.size ? spawnSet : true);
      updateHUD();
    },
    onState: () => { updateHUD(); },
    onMove: () => { updateHUD(); },
  });

  $("#gameLevelNum").textContent = String(level.id);
  $("#gameLevelTitle").textContent = level.title;
  $("#gameLevelStory").textContent = level.story;
  updateHUD();
  renderBoard(engine.board, [], true);
  showScreen("game");
}

function updateHUD() {
  if (!engine) return;
  const snap = engine.snapshot();
  const goal = snap.goal;
  const [s1, s2, s3] = engine.level.starThresholds;
  $("#scoreText").textContent = String(snap.score);
  $("#targetScoreText").textContent = String(s1);
  $("#movesText").textContent = `${snap.movesLeft}`;
  $("#goalText").textContent = goal.text;
  const nextStar = snap.stars < 1 ? `★ ${s1}` : snap.stars < 2 ? `★★ ${s2}` : snap.stars < 3 ? `★★★ ${s3}` : "★★★ макс";
  $("#goalProgressText").textContent = `${Math.min(goal.current, goal.target)}/${goal.target} · ${nextStar}`;
  const pct = Math.min(100, (goal.current / goal.target) * 100);
  $("#goalProgressFill").style.width = pct + "%";

  const stars = snap.stars;
  $$("#starsRow .star-slot").forEach((el, i) => {
    el.classList.toggle("earned", i < stars);
  });

  if (snap.over && !endModalShown) {
    endModalShown = true;
    setTimeout(() => showEndModal(snap), 350);
  }
}

function renderBoard(board, markedMatrix = [], spawn = false) {
  const boardEl = $("#board");
  boardEl.innerHTML = "";
  const spawnAll = spawn === true;
  const spawnSet = spawn instanceof Set ? spawn : null;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const t = board[r][c];
      const tile = document.createElement("button");
      tile.className = "tile";
      const key = r + "," + c;
      if (t >= 0 && (spawnAll || (spawnSet && spawnSet.has(key)))) {
        tile.classList.add("spawn");
        tile.style.animationDelay = (r * 0.04) + "s";
        tile.style.animationDuration = (0.42 + r * 0.015) + "s";
      }
      if (selected && selected.r === r && selected.c === c) tile.classList.add("selected");
      if (markedMatrix[r] && markedMatrix[r][c]) tile.classList.add("matched");
      tile.dataset.r = String(r);
      tile.dataset.c = String(c);
      if (t < 0) {
        tile.classList.add("empty");
        tile.dataset.type = "";
        tile.innerHTML = "";
      } else {
        tile.dataset.type = String(t);
        const gem = TILE_TYPES[t]?.gem || "";
        tile.innerHTML = `<span class="gem">${gem}</span>`;
      }
      tile.addEventListener("click", onTileClick);
      boardEl.appendChild(tile);
    }
  }
}

async function onTileClick(e) {
  ensureAudio();
  if (!engine || engine.busy || engine.over) return;
  const tile = e.currentTarget;
  const r = Number(tile.dataset.r);
  const c = Number(tile.dataset.c);

  if (!selected) {
    selected = { r, c };
    renderBoard(engine.board, []);
    return;
  }

  if (selected.r === r && selected.c === c) {
    selected = null;
    renderBoard(engine.board, []);
    return;
  }

  const target = { r, c };
  if (engine.isAdjacent(selected, target)) {
    const a = selected;
    selected = null;
    renderBoard(engine.board, []);
    await engine.trySwap(a, target);
    if (!engine.over) renderBoard(engine.board, []);
  } else {
    selected = { r, c };
    renderBoard(engine.board, []);
  }
}

// ---------- Modal ----------
function showLevelBrief(levelId) {
  const level = LEVELS.find((l) => l.id === levelId);
  if (!level) return;
  const stars = state.starsEarned[levelId] || 0;
  const goal = level.goal.type === "score"
    ? `Набрать ${level.goal.target} очков`
    : `Собрать ${TILE_TYPES[level.goal.tile].gem} ${TILE_TYPES[level.goal.tile].name}: ${level.goal.target}`;
  const [s1, s2, s3] = level.starThresholds;
  $("#confetti").innerHTML = "";
  $("#modalStars").innerHTML = [1,2,3].map(i => `<span class="${i <= stars ? "earned" : ""}">★</span>`).join("");
  $("#modalTitle").textContent = `Уровень ${level.id}: ${level.title}`;
  $("#modalText").textContent = level.story;
  $("#modalReward").innerHTML = `<div style="color:var(--text);font-size:0.98rem;line-height:1.6"><strong style="color:var(--gold)">Цель:</strong> ${goal}<br><span style="color:var(--muted)">Ходов: ${level.moves}</span><div style="margin-top:8px;color:var(--muted)"><strong style="color:var(--gold)">Звёзды:</strong> ★ ${s1} · ★★ ${s2} · ★★★ ${s3} очков</div></div>`;
  const actions = $("#modalActions");
  actions.innerHTML = "";
  const backBtn = document.createElement("button");
  backBtn.className = "btn btn-secondary";
  backBtn.textContent = "Назад";
  backBtn.addEventListener("click", hideModal);
  const startBtn = document.createElement("button");
  startBtn.className = "btn btn-primary";
  startBtn.textContent = "Начать";
  startBtn.addEventListener("click", () => { hideModal(); startLevel(level.id); });
  actions.append(backBtn, startBtn);
  $("#modal").classList.remove("hidden");
}

function showEndModal(snap) {
  if (!engine || engine.level.id !== currentLevelId) return;
  if (!$("#screen-game").classList.contains("active")) return;
  const level = engine.level;
  const won = snap.won;
  const stars = won ? engine.starsForScore(snap.score) : 0;
  const prevStars = state.starsEarned[level.id] || 0;

  if (won) {
    recordLevelResult(state, level.id, stars);
    saveState(state);
    renderTopbar();
    sfxWin();
    burstConfetti();
  } else {
    sfxLose();
  }

  const modal = $("#modal");
  const starsEl = $("#modalStars");
  starsEl.innerHTML = [1,2,3].map(i => `<span class="${i <= stars ? "earned" : ""}">★</span>`).join("");

  $("#modalTitle").textContent = won ? "Уровень пройден!" : "Ходы закончились";
  const gained = won ? Math.max(0, stars - prevStars) : 0;
  const starWord = stars === 1 ? "звезду" : (stars >= 2 && stars <= 4) ? "звезды" : "звёзд";
  $("#modalText").textContent = won
    ? `«${level.title}» завершён. ${gained > 0 ? `Отлично! Вы заработали ${stars} ${starWord}!` : `Вы набрали ${stars} ${starWord} за этот уровень.`}`
    : `Не хватило немного магии. Попробуй ещё раз — цель: ${engine.goalProgress().text.toLowerCase()}.`;

  const [s1,s2,s3] = level.starThresholds;
  $("#modalReward").innerHTML = won
    ? `<div>Счёт: ${snap.score}</div><div style="margin-top:4px;color:var(--muted);font-size:0.9rem">Звёзды: ★ ${s1} · ★★ ${s2} · ★★★ ${s3}</div>`
    : `Счёт: ${snap.score}`;

  const actions = $("#modalActions");
  actions.innerHTML = "";

  const retryBtn = document.createElement("button");
  retryBtn.className = "btn btn-secondary";
  retryBtn.textContent = "Ещё раз";
  retryBtn.addEventListener("click", () => { hideModal(); startLevel(level.id); });

  const mapBtn = document.createElement("button");
  mapBtn.className = "btn btn-ghost";
  mapBtn.textContent = "К карте";
  mapBtn.addEventListener("click", () => { hideModal(); showScreen("map"); renderMap(); });

  actions.appendChild(retryBtn);
  if (won) {
    const next = LEVELS.find((l) => l.id === level.id + 1);
    if (next) {
      const nextBtn = document.createElement("button");
      nextBtn.className = "btn btn-primary";
      nextBtn.textContent = "Следующий уровень";
      nextBtn.addEventListener("click", () => { hideModal(); startLevel(next.id); });
      actions.appendChild(nextBtn);
    } else {
      const doneBtn = document.createElement("button");
      doneBtn.className = "btn btn-primary";
      doneBtn.textContent = "К саду";
      doneBtn.addEventListener("click", () => { hideModal(); showScreen("map"); renderMap(); });
      actions.appendChild(doneBtn);
    }
  } else {
    retryBtn.className = "btn btn-primary";
  }

  modal.classList.remove("hidden");
}

function hideModal() { $("#modal").classList.add("hidden"); $("#confetti").innerHTML = ""; }
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") { /* don't close on backdrop during end */ } });

// ---------- Init ----------
initSparkles();
renderMap();
showScreen("map");