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
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
}
function beep(freq = 440, dur = 0.08, type = "sine", gain = 0.035) {
  if (!audioCtx) return;
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
    btn.addEventListener("click", () => { ensureAudio(); startLevel(level.id); });
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
    onSwap: (a, b) => { sfxSwap(); renderBoard(engine.board, []); },
    onSwapBack: () => { sfxBad(); renderBoard(engine.board, []); },
    onMatch: ({ marked, combo }) => {
      sfxMatch(combo);
      renderBoard(engine.board, marked);
      updateHUD();
    },
    onClear: (board) => { renderBoard(board, []); },
    onRefill: (board) => { renderBoard(board, [], true); updateHUD(); },
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
  $("#scoreText").textContent = String(snap.score);
  $("#targetScoreText").textContent = String(engine.level.starThresholds[0]);
  $("#movesText").textContent = `${snap.movesLeft} ходов`;
  $("#goalText").textContent = goal.text;
  $("#goalProgressText").textContent = `${Math.min(goal.current, goal.target)} / ${goal.target}`;
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
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const t = board[r][c];
      const tile = document.createElement("button");
      tile.className = "tile";
      if (spawn && t >= 0) tile.classList.add("spawn");
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
  } else {
    sfxLose();
  }

  const modal = $("#modal");
  const starsEl = $("#modalStars");
  starsEl.innerHTML = [1,2,3].map(i => `<span class="${i <= stars ? "earned" : ""}">★</span>`).join("");

  $("#modalTitle").textContent = won ? "Уровень пройден!" : "Ходы закончились";
  $("#modalText").textContent = won
    ? `«${level.title}» завершён. ${stars > prevStars ? "Новый рекорд звёзд!" : "Сад становится светлее."}`
    : `Не хватило немного магии. Попробуй ещё раз — цель: ${engine.goalProgress().text.toLowerCase()}.`;

  const gained = won ? Math.max(0, stars - prevStars) : 0;
  $("#modalReward").textContent = won ? `Счёт: ${snap.score} · Звёзд получено: +${gained}` : `Счёт: ${snap.score}`;

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

function hideModal() { $("#modal").classList.add("hidden"); }
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") { /* don't close on backdrop during end */ } });

// ---------- Init ----------
renderMap();
showScreen("map");