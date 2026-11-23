import { LEVELS, UPGRADES, GARDENS, TILE_TYPES, STORY_INTRO } from "./data.js";
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
let selectedGardenId = GARDENS[0].id;
let hintMove = null;
let hintIdleTimer = null;
let drag = null;
let suppressClick = false;
let autoPlaying = false;

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

// ---------- Theme / progression / parallax ----------
const THEMES = ["default", "night", "autumn", "winter"];
function applyTheme() {
  const t = THEMES.includes(state.theme) ? state.theme : "default";
  state.theme = t;
  document.body.dataset.theme = t;
  const labels = { default: "🎨 Тема", night: "🌙 Ночь", autumn: "🍂 Осень", winter: "❄️ Зима" };
  const label = labels[t] || labels.default;
  const hb = $("#homeThemeBtn"); if (hb) hb.textContent = label;
  const tb = $("#themeBtn"); if (tb) tb.title = `Тема: ${label}`;
}
function cycleTheme() {
  ensureAudio();
  const idx = THEMES.indexOf(state.theme);
  state.theme = THEMES[(idx + 1) % THEMES.length];
  saveState(state);
  applyTheme();
}

function applyWorldProgression() {
  const builtSet = new Set(state.upgradesBuilt);
  const g1 = GARDENS[0].upgrades.filter(u => builtSet.has(u.id)).length / GARDENS[0].upgrades.length;
  const g2 = GARDENS[1].upgrades.filter(u => builtSet.has(u.id)).length / GARDENS[1].upgrades.length;
  const g3 = GARDENS[2].upgrades.filter(u => builtSet.has(u.id)).length / GARDENS[2].upgrades.length;
  const g4 = GARDENS[3].upgrades.filter(u => builtSet.has(u.id)).length / GARDENS[3].upgrades.length;
  const total = (g1 + g2 + g3 + g4) / 4;
  const root = document.querySelector(".forest-bg");
  if (root) {
    root.style.setProperty("--mist-o", String(Math.max(0.08, 0.62 - total * 0.5)));
    root.style.setProperty("--world-glow", String(total));
    root.style.setProperty("--flowers-o", String(Math.min(1, g1 * 1.1)));
    root.style.setProperty("--moon-o", String(Math.min(1, g3 * 1.1)));
    root.style.setProperty("--castle-o", String(Math.min(1, g4 * 1.1)));
  }
  const sparkWrap = $("#bgSparkles");
  if (sparkWrap) {
    const want = Math.round(24 + total * 30 + g2 * 18);
    const cur = sparkWrap.childElementCount;
    if (cur < want) {
      for (let i = cur; i < want; i++) {
        const s = document.createElement("span");
        s.className = "bg-sparkle";
        s.style.left = Math.random() * 100 + "%";
        s.style.top = (18 + Math.random() * 78) + "%";
        s.style.setProperty("--dur", (2.4 + Math.random() * 3.8).toFixed(2) + "s");
        s.style.setProperty("--drift", (6 + Math.random() * 8).toFixed(2) + "s");
        s.style.setProperty("--delay", (-Math.random() * 5).toFixed(2) + "s");
        const size = 2 + Math.random() * 5;
        s.style.width = size + "px"; s.style.height = size + "px";
        sparkWrap.appendChild(s);
      }
    }
  }
}

function initParallax() {
  const layers = [
    { el: $("#bgSky"), k: 0.012 },
    { el: $("#bgArt"), k: 0.02 },
    { el: $("#bgCastle"), k: 0.028 },
    { el: $("#bgMid"), k: 0.016 },
    { el: $("#mistA"), k: 0.035 },
    { el: $("#mistB"), k: 0.025 },
    { el: $("#bgFlowers"), k: 0.04 },
    { el: $("#bgMoon"), k: 0.01 },
  ].filter(x => x.el);
  let raf = 0, tx = 0, ty = 0;
  const apply = () => {
    raf = 0;
    for (const { el, k } of layers) {
      el.style.translate = `${tx * k}px ${ty * k}px`;
    }
  };
  window.addEventListener("pointermove", (e) => {
    tx = (e.clientX / window.innerWidth - 0.5) * 40;
    ty = (e.clientY / window.innerHeight - 0.5) * 24;
    if (!raf) raf = requestAnimationFrame(apply);
  }, { passive: true });
}

function initHomePathSparkles() {
  const wrap = $("#homePathSparkles");
  if (!wrap) return;
  wrap.innerHTML = "";
  for (let i = 0; i < 14; i++) {
    const s = document.createElement("span");
    s.className = "path-sparkle";
    s.style.left = (30 + Math.random() * 40) + "%";
    s.style.top = (10 + Math.random() * 80) + "%";
    s.style.setProperty("--pd", (2.2 + Math.random() * 2.6).toFixed(2) + "s");
    s.style.animationDelay = (-Math.random() * 3).toFixed(2) + "s";
    const size = 2 + Math.random() * 3;
    s.style.width = size + "px"; s.style.height = size + "px";
    wrap.appendChild(s);
  }
}

// ---------- Navigation ----------
function showScreen(name) {
  $$(".screen").forEach((s) => s.classList.remove("active"));
  $(`#screen-${name}`).classList.add("active");
  if (name === "world") requestAnimationFrame(() => renderWorld());
}

let worldResizeTimer = 0;
window.addEventListener("resize", () => {
  if (!$("#screen-world").classList.contains("active")) return;
  clearTimeout(worldResizeTimer);
  worldResizeTimer = setTimeout(() => renderWorld(), 150);
});

$("#homeBtn").addEventListener("click", () => { showScreen("home"); renderMap(); });
$("#homeBtn").addEventListener("keydown", (e) => { if (e.key === "Enter") { showScreen("home"); renderMap(); } });
$("#backToMapBtn").addEventListener("click", () => { showScreen("path"); renderMap(); });
$("#pathBackBtn")?.addEventListener("click", () => { showScreen("home"); });
$("#worldBackBtn")?.addEventListener("click", () => { showScreen("home"); });
$("#restartBtn").addEventListener("click", () => { if (currentLevelId) startLevel(currentLevelId); });
$("#soundBtn").addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  $("#soundBtn").textContent = soundEnabled ? "🔊" : "🔇";
  if (soundEnabled) ensureAudio();
});
$("#themeBtn")?.addEventListener("click", cycleTheme);
$("#homeThemeBtn")?.addEventListener("click", cycleTheme);

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
      <div>🏡 Построек в мире: <strong>${built}/${UPGRADES.length}</strong></div>
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

const heroinePhrases = [
  "Привет! Я Люмина. Поможешь вернуть свет волшебным землям?",
  "Каждая звезда делает этот мир ярче!",
  "Нажми «В путь», и мы отправимся в приключение.",
  "В Сказочном мире можно тратить звёзды на чудеса.",
  "Не сдавайся — даже один ход может всё изменить!"
];
let heroineSpeechTimer = null;
$("#heroineImg")?.addEventListener("click", () => {
  ensureAudio();
  const bubble = $("#heroineSpeech");
  if (!bubble) return;
  bubble.textContent = heroinePhrases[Math.floor(Math.random() * heroinePhrases.length)];
  bubble.classList.add("is-visible");
  clearTimeout(heroineSpeechTimer);
  heroineSpeechTimer = setTimeout(() => bubble.classList.remove("is-visible"), 4000);
});

$("#navPlayBtn")?.addEventListener("click", () => { ensureAudio(); renderMap(); showScreen("path"); });
$("#navForestBtn")?.addEventListener("click", () => { ensureAudio(); renderMap(); showScreen("world"); });
$("#navAchievementsBtn")?.addEventListener("click", () => { ensureAudio(); showAchievementsModal(); });

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

  // pick garden for UI: current unlocked level's garden
  const current = LEVELS.find((l) => isLevelUnlocked(l.id, state) && (state.starsEarned[l.id] || 0) === 0) || LEVELS[LEVELS.length - 1];
  if (current) selectedGardenId = current.gardenId;

  const map = $("#levelMap");
  map.innerHTML = "";
  for (const garden of GARDENS) {
    const section = document.createElement("div");
    section.className = "map-garden";
    const levels = LEVELS.filter((l) => l.gardenId === garden.id);
    const done = levels.filter((l) => (state.starsEarned[l.id] || 0) > 0).length;
    section.innerHTML = `<div class="map-garden-head"><div><div class="map-garden-name">${garden.name}</div><div class="map-garden-meta">${done}/${levels.length} уровней</div></div></div>`;
    const grid = document.createElement("div");
    grid.className = "level-grid";
    for (const level of levels) {
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
      grid.appendChild(btn);
    }
    section.appendChild(grid);
    map.appendChild(section);
  }

  renderWorld();
  applyWorldProgression();
}

function showUpgradeModal(upgrade, garden) {
  const built = new Set(state.upgradesBuilt).has(upgrade.id);
  const bank = starBank(state, UPGRADES);
  const canBuy = !built && bank >= upgrade.cost;

  $("#modalStars").innerHTML = `<span class="modal-icon">${upgrade.icon || "✨"}</span>`;
  $("#modalTitle").textContent = upgrade.name;
  $("#modalText").textContent = upgrade.desc || "";
  $("#modalReward").innerHTML = built
    ? `<div class="modal-reward-built">✨ Уже открыто в «${garden.short}»</div>`
    : `<div>Стоимость: ★ ${upgrade.cost}</div><div style="margin-top:4px;color:var(--muted);font-size:0.9rem">У вас: ★ ${bank}</div>`;

  const actions = $("#modalActions");
  actions.innerHTML = "";

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn btn-secondary";
  closeBtn.textContent = built ? "Закрыть" : "Позже";
  closeBtn.addEventListener("click", hideModal);
  actions.appendChild(closeBtn);

  if (!built) {
    const buyBtn = document.createElement("button");
    buyBtn.className = "btn btn-primary" + (canBuy ? "" : " btn-disabled");
    buyBtn.textContent = canBuy ? `Купить за ★ ${upgrade.cost}` : "Не хватает звёзд";
    buyBtn.disabled = !canBuy;
    buyBtn.addEventListener("click", () => {
      ensureAudio();
      if (buildUpgrade(state, upgrade.id, UPGRADES)) {
        sfxBuy();
        saveState(state);
        hideModal();
        const keepGarden = selectedGardenId;
        renderMap();
        selectedGardenId = keepGarden;
        renderWorld();
      }
    });
    actions.appendChild(buyBtn);
  }

  $("#modal").classList.remove("hidden");
}

function renderWorld() {
  const builtSet = new Set(state.upgradesBuilt);
  const garden = GARDENS.find((g) => g.id === selectedGardenId) || GARDENS[0];
  selectedGardenId = garden.id;
  $("#gardenTitle").textContent = garden.name;
  $("#gardenStory").textContent = garden.story;

  const tabs = $("#gardenTabs");
  tabs.innerHTML = "";
  for (const g of GARDENS) {
    const done = g.upgrades.filter((u) => builtSet.has(u.id)).length;
    const btn = document.createElement("button");
    btn.className = "garden-tab" + (g.id === garden.id ? " is-active" : "");
    btn.innerHTML = `<span>${g.short}</span><small>${done}/${g.upgrades.length}</small>`;
    btn.addEventListener("click", () => { selectedGardenId = g.id; renderWorld(); });
    tabs.appendChild(btn);
  }

  const scene = $("#worldScene");
  const bwLayer = $("#worldBw");
  const colorLayer = $("#worldColor");
  const mist = $("#worldMist");
  const items = $("#worldItems");
  const bank = starBank(state, UPGRADES);
  const totalUp = garden.upgrades.length;
  const builtCount = garden.upgrades.filter((u) => builtSet.has(u.id)).length;
  const progress = totalUp ? builtCount / totalUp : 0;

  // Scene box matches the background image aspect so nothing is cropped
  // and image-space % coordinates (hotspots / reveal mask) align with objects.
  scene.style.width = "";
  scene.style.height = "";
  scene.style.marginInline = "";
  scene.classList.remove("is-compact");
  if (garden.scene.img && scene.clientWidth > 50) {
    const [iw, ih] = garden.scene.img;
    const avail = scene.clientWidth;
    const maxH = 420;
    let h = avail * (ih / iw);
    let w = avail;
    if (h > maxH) { h = maxH; w = maxH * (iw / ih); }
    scene.style.width = `${Math.round(w)}px`;
    scene.style.height = `${Math.round(h)}px`;
    scene.style.marginInline = "auto";
  }
  scene.classList.toggle("is-compact", scene.clientWidth < 400);

  // layers
  if (garden.scene.bw && garden.scene.bg) {
    bwLayer.style.background = `url('${garden.scene.bw}') center/cover no-repeat`;
    bwLayer.style.opacity = "1";
    bwLayer.style.filter = "none";
    colorLayer.style.background = `url('${garden.scene.bg}') center/cover no-repeat`;
    colorLayer.style.opacity = "1";
    // reveal mask around built upgrades
    const builtUpgrades = garden.upgrades.filter(u => builtSet.has(u.id));
    const reveals = builtUpgrades.flatMap(u => {
      const pts = u.reveal || (u.at ? [{ x: u.at.x, y: u.at.y, rx: 18, ry: 18 }] : []);
      return pts.map(p =>
        `radial-gradient(ellipse ${p.rx}% ${p.ry}% at ${p.x}% ${p.y}%, #000 0%, #000 58%, rgba(0,0,0,0.85) 70%, transparent 86%)`
      );
    });
    if (reveals.length === 0) {
      colorLayer.style.webkitMaskImage = "none";
      colorLayer.style.maskImage = "none";
      colorLayer.style.opacity = "0";
    } else if (builtUpgrades.length === totalUp) {
      colorLayer.style.webkitMaskImage = "none";
      colorLayer.style.maskImage = "none";
      colorLayer.style.opacity = "1";
    } else {
      const mask = reveals.join(", ");
      colorLayer.style.webkitMaskImage = mask;
      colorLayer.style.maskImage = mask;
      colorLayer.style.webkitMaskComposite = "source-over";
      colorLayer.style.maskComposite = "add";
      colorLayer.style.opacity = "1";
    }
    scene.style.background = "#1a1028";
  } else if (garden.scene.bg) {
    bwLayer.style.background = `url('${garden.scene.bg}') center/cover no-repeat`;
    bwLayer.style.opacity = "1";
    bwLayer.style.filter = `grayscale(${Math.max(0, 1 - progress)}) brightness(${0.75 + progress * 0.25})`;
    colorLayer.style.opacity = "0";
    colorLayer.style.webkitMaskImage = "none";
    colorLayer.style.maskImage = "none";
    scene.style.background = "#1a1028";
  } else {
    bwLayer.style.background = `linear-gradient(180deg, ${garden.scene.sky[0]} 0%, ${garden.scene.sky[1]} 35%, ${garden.scene.ground[0]} 35%, ${garden.scene.ground[1]} 100%)`;
    bwLayer.style.filter = `grayscale(${Math.max(0, 1 - progress)})`;
    bwLayer.style.opacity = "1";
    colorLayer.style.opacity = "0";
    colorLayer.style.webkitMaskImage = "none";
    colorLayer.style.maskImage = "none";
    scene.style.background = "transparent";
  }

  mist.style.opacity = String(Math.max(0, 0.72 - builtCount * 0.15));
  mist.style.background = `linear-gradient(180deg, ${garden.scene.mist}, rgba(140,130,170,0.18))`;

  items.innerHTML = "";
  for (const u of garden.upgrades) {
    const built = builtSet.has(u.id);
    const canBuy = !built && bank >= u.cost;
    const el = document.createElement("button");
    el.type = "button";
    el.className = "world-hotspot world-hotspot-pinonly" + (built ? " is-built" : canBuy ? " is-available" : " is-locked");
    const p = u.at ? { x: u.at.x, y: u.at.y } : hotspotPos(u.sceneStyle);
    el.classList.add("is-at");
    el.style.left = `${p.x}%`;
    el.style.top = `${p.y}%`;
    el.innerHTML = `<span class="hotspot-pin">${built ? "✓" : u.icon || "★"}</span>`;
    el.title = u.name;
    el.setAttribute("aria-label", u.name);
    el.addEventListener("click", () => {
      ensureAudio();
      showUpgradeModal(u, garden);
    });
    items.appendChild(el);
  }
}

function layoutHotspots(scene, items) {
  const sRect = scene.getBoundingClientRect();
  if (sRect.width < 50 || sRect.height < 50) return;
  const els = Array.from(items.querySelectorAll(".world-hotspot"));
  const placed = [];
  const STEP = 4;
  const gap = 4;
  for (const el of els) {
    el.style.left = el.dataset.baseLeft;
    el.style.top = el.dataset.baseTop;
    const r0 = el.getBoundingClientRect();
    const w = r0.width, h = r0.height;
    const baseX = r0.left - sRect.left, baseY = r0.top - sRect.top;
    const maxX = Math.max(120, Math.ceil((w * 1.5) / STEP) * STEP);
    const maxY = Math.max(160, Math.ceil((3 * (h + gap)) / STEP) * STEP);
    let best = null, bestScore = Infinity;
    for (let dy = -maxY; dy <= maxY; dy += STEP) {
      for (let dx = -maxX; dx <= maxX; dx += STEP) {
        const x = baseX + dx, y = baseY + dy;
        const out =
          Math.max(0, 2 - x) + Math.max(0, 2 - y) +
          Math.max(0, x + w - (sRect.width - 2)) + Math.max(0, y + h - (sRect.height - 2));
        let overlap = 0;
        for (const p of placed) {
          const ox = Math.min(x + w + gap, p.x + p.w + gap) - Math.max(x - gap, p.x - gap);
          const oy = Math.min(y + h + gap, p.y + p.h + gap) - Math.max(y - gap, p.y - gap);
          if (ox > 0 && oy > 0) overlap += ox * oy;
        }
        const dist = Math.abs(dx) * 0.8 + Math.abs(dy) * 0.6;
        const score = out * 2000 + overlap * 12 + dist;
        if (score < bestScore) { bestScore = score; best = [dx, dy]; if (score === 0) break; }
      }
      if (bestScore === 0) break;
    }
    if (!best) best = [0, 0];
    let fx = baseX + best[0], fy = baseY + best[1];
    fx = Math.max(2, Math.min(sRect.width - w - 2, fx));
    fy = Math.max(2, Math.min(sRect.height - h - 2, fy));
    el.style.left = `calc(${el.dataset.baseLeft} + ${fx - baseX}px)`;
    el.style.top = `calc(${el.dataset.baseTop} + ${fy - baseY}px)`;
    placed.push({ x: fx, y: fy, w, h });
  }
}

function hotspotPos(style = {}) {
  let x = 50, y = 50;
  if (style.left) x = parseFloat(style.left);
  if (style.right) x = 100 - parseFloat(style.right);
  if (style.top) y = parseFloat(style.top);
  if (style.bottom) y = 100 - parseFloat(style.bottom);
  // sceneStyle bottom is from bottom, so y is already correct (100-bottom)
  return { x: Math.max(5, Math.min(95, x)), y: Math.max(5, Math.min(95, y)) };
}

// ---------- Fairy hint ----------
function findValidMove(board) {
  const size = board.length;
  function hasMatch(b) {
    for (let r = 0; r < size; r++) for (let c = 0; c < size - 2; c++) { const v = b[r][c]; if (v >= 0 && v === b[r][c+1] && v === b[r][c+2]) return true; }
    for (let c = 0; c < size; c++) for (let r = 0; r < size - 2; r++) { const v = b[r][c]; if (v >= 0 && v === b[r+1][c] && v === b[r+2][c]) return true; }
    return false;
  }
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    for (const [dr,dc] of [[1,0],[0,1]]) {
      const nr = r+dr, nc = c+dc; if (nr>=size||nc>=size) continue;
      const b = board.map(row => row.slice());
      [b[r][c], b[nr][nc]] = [b[nr][nc], b[r][c]];
      if (hasMatch(b)) return { a:{r,c}, b:{r:nr,c:nc} };
    }
  }
  return null;
}
function clearHint() {
  hintMove = null;
  $("#fairyHint")?.classList.add("hidden");
  $$(".tile.hint-from, .tile.hint-to").forEach(el => el.classList.remove("hint-from","hint-to"));
}
function showFairyHint(msg) {
  if (!engine || engine.busy || engine.over || autoPlaying) return;
  const move = findValidMove(engine.board);
  hintMove = move;
  renderBoard(engine.board, []);
  if (move) {
    tileEl(move.a.r, move.a.c)?.classList.add("hint-from");
    tileEl(move.b.r, move.b.c)?.classList.add("hint-to");
  }
  const hint = $("#fairyHint");
  if (hint) {
    hint.textContent = msg || (move ? "Люмина подсказывает: попробуй этот ход ✨" : "Люмина: ходов не видно — попробуй перезапустить уровень.");
    hint.classList.remove("hidden");
    setTimeout(() => { if (hint.textContent === hint.textContent) hint.classList.add("hidden"); }, 3500);
  }
}
function scheduleIdleHint() {
  clearTimeout(hintIdleTimer);
  if (!engine || engine.over) return;
  hintIdleTimer = setTimeout(() => {
    if (!engine || engine.over || engine.busy) return;
    showFairyHint("Люмина: вижу хороший ход! Попробуй подсвеченные фишки ✨");
  }, 12000);
}
$("#hintBtn")?.addEventListener("click", () => { ensureAudio(); showFairyHint("Люмина подсказывает: попробуй этот ход ✨"); });

// ---------- Game ----------
function startLevel(levelId) {
  const level = LEVELS.find((l) => l.id === levelId);
  if (!level) return;
  currentLevelId = levelId;
  selected = null;
  endModalShown = false;
  autoPlaying = false;
  const ov = $("#boardOverlay"); if (ov) { ov.textContent = ""; ov.classList.add("hidden"); }
  clearHint();
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
  scheduleIdleHint();
}

function countMatchesOnBoard(board) {
  const size = board.length;
  const marked = Array.from({ length: size }, () => Array(size).fill(false));
  let any = false;
  for (let r = 0; r < size; r++) {
    let c = 0;
    while (c < size) {
      const t = board[r][c]; if (t < 0) { c++; continue; }
      let end = c + 1; while (end < size && board[r][end] === t) end++;
      if (end - c >= 3) { for (let k = c; k < end; k++) marked[r][k] = true; any = true; }
      c = end;
    }
  }
  for (let c = 0; c < size; c++) {
    let r = 0;
    while (r < size) {
      const t = board[r][c]; if (t < 0) { r++; continue; }
      let end = r + 1; while (end < size && board[end][c] === t) end++;
      if (end - r >= 3) { for (let k = r; k < end; k++) marked[k][c] = true; any = true; }
      r = end;
    }
  }
  let n = 0; for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (marked[r][c]) n++;
  return { any, count: n };
}

function findBestMove(board) {
  const size = board.length;
  let best = null;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    for (const [dr,dc] of [[1,0],[0,1]]) {
      const nr = r+dr, nc = c+dc; if (nr>=size||nc>=size) continue;
      const b = board.map(row => row.slice());
      [b[r][c], b[nr][nc]] = [b[nr][nc], b[r][c]];
      const res = countMatchesOnBoard(b);
      if (!res.any) continue;
      const score = res.count;
      if (!best || score > best.score) best = { a:{r,c}, b:{r:nr,c:nc}, score };
    }
  }
  return best;
}

async function runAutoPlay() {
  if (autoPlaying || !engine || engine.over) return;
  const myEngine = engine;
  autoPlaying = true;
  const overlay = $("#boardOverlay");
  if (overlay) { overlay.textContent = "Цель выполнена! Автоигра…"; overlay.classList.remove("hidden"); }
  try {
    while (engine === myEngine && !myEngine.over && myEngine.movesLeft > 0) {
      if (!$("#screen-game").classList.contains("active")) break;
      const move = findBestMove(myEngine.board);
      if (!move) break;
      selected = null;
      await myEngine.trySwap(move.a, move.b);
      if (engine !== myEngine) break;
      if (!myEngine.over) renderBoard(myEngine.board, []);
      await new Promise(res => setTimeout(res, 180));
    }
  } finally {
    if (engine === myEngine) {
      autoPlaying = false;
      if (overlay) { overlay.textContent = ""; overlay.classList.add("hidden"); }
    }
  }
}

function updateHUD() {
  if (!engine) return;
  const snap = engine.snapshot();
  const goal = snap.goal;
  const [s1, s2, s3] = engine.level.starThresholds;
  $("#scoreText").textContent = String(snap.score);
  $("#targetScoreText").textContent = String(s1);
  $("#movesText").textContent = `${snap.movesLeft}`;
  $("#goalText").textContent = goal.done ? `✓ ${goal.text}` : goal.text;
  const nextStar = snap.stars < 1 ? `★ ${s1}` : snap.stars < 2 ? `★★ ${s2}` : snap.stars < 3 ? `★★★ ${s3}` : "★★★ макс";
  const prog = `${Math.min(goal.current, goal.target)}/${goal.target}`;
  $("#goalProgressText").textContent = goal.done ? `${prog} · цель выполнена · ${nextStar}` : `${prog} · ${nextStar}`;
  const pct = Math.min(100, (goal.current / goal.target) * 100);
  $("#goalProgressFill").style.width = pct + "%";

  const stars = snap.stars;
  $$("#starsRow .star-slot").forEach((el, i) => {
    el.classList.toggle("earned", i < stars);
  });

  if (!engine.busy && goal.done && !snap.over && snap.movesLeft > 0 && !autoPlaying) {
    runAutoPlay();
  }

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
  if (suppressClick) { suppressClick = false; return; }
  ensureAudio();
  clearHint();
  clearTimeout(hintIdleTimer);
  if (!engine || engine.busy || engine.over || autoPlaying) return;
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
  scheduleIdleHint();
}

// ---------- Swipe ----------
function setupSwipe() {
  const boardEl = $("#board");
  if (!boardEl) return;
  const THRESH = 22;
  boardEl.addEventListener("pointerdown", (e) => {
    if (!engine || engine.busy || engine.over || autoPlaying) return;
    const tile = e.target.closest(".tile");
    if (!tile || tile.classList.contains("empty")) return;
    drag = {
      startX: e.clientX, startY: e.clientY,
      r: Number(tile.dataset.r), c: Number(tile.dataset.c),
      handled: false, pointerId: e.pointerId,
    };
    boardEl.setPointerCapture?.(e.pointerId);
  });
  boardEl.addEventListener("pointermove", async (e) => {
    if (!drag || drag.handled || e.pointerId !== drag.pointerId) return;
    if (!engine || engine.busy || engine.over || autoPlaying) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) < THRESH && Math.abs(dy) < THRESH) return;
    let dr = 0, dc = 0;
    if (Math.abs(dx) > Math.abs(dy)) dc = dx > 0 ? 1 : -1;
    else dr = dy > 0 ? 1 : -1;
    const nr = drag.r + dr, nc = drag.c + dc;
    drag.handled = true;
    suppressClick = true;
    if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) return;
    ensureAudio();
    clearHint();
    clearTimeout(hintIdleTimer);
    selected = null;
    renderBoard(engine.board, []);
    await engine.trySwap({ r: drag.r, c: drag.c }, { r: nr, c: nc });
    if (!engine.over) renderBoard(engine.board, []);
    scheduleIdleHint();
  });
  const endDrag = (e) => {
    if (!drag) return;
    if (drag.handled) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 250); }
    if (e?.pointerId != null) boardEl.releasePointerCapture?.(e.pointerId);
    drag = null;
  };
  boardEl.addEventListener("pointerup", endDrag);
  boardEl.addEventListener("pointercancel", endDrag);
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
  $("#modalReward").innerHTML = `<div style="color:var(--text);font-size:0.98rem;line-height:1.6"><strong style="color:var(--gold)">Цель:</strong> ${goal}<br><span style="color:var(--muted)">Ходов: ${level.moves} · Выполните цель и набирайте очки для звёзд</span><div style="margin-top:8px;color:var(--muted)"><strong style="color:var(--gold)">Звёзды за очки:</strong> ★ ${s1} · ★★ ${s2} · ★★★ ${s3}</div></div>`;
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
  clearHint();
  clearTimeout(hintIdleTimer);
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
  mapBtn.textContent = "К уровням";
  mapBtn.addEventListener("click", () => { hideModal(); showScreen("path"); renderMap(); });

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
      doneBtn.addEventListener("click", () => { hideModal(); showScreen("world"); renderMap(); });
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
initHomePathSparkles();
initParallax();
setupSwipe();
applyTheme();
renderMap();
applyWorldProgression();
showScreen("home");