const SAVE_KEY = "fairy-match3-save-v1";

function defaultState() {
  return {
    starsEarned: {},      // levelId -> 0..3
    upgradesBuilt: [],    // upgrade ids
    selectedLevel: 1,
    theme: "default",     // default | night | autumn | winter
    boosters: { hammer: 3, bomb: 3, shuffle: 3 },
    dailyRewardLastClaim: null, // "YYYY-MM-DD"
    locationRewardsClaimed: [], // garden ids
  };
}

function normalizeState(s) {
  const d = defaultState();
  const boosters = { ...d.boosters, ...(s.boosters || {}) };
  for (const k of ["hammer", "bomb", "shuffle"]) boosters[k] = Math.max(0, Number(boosters[k] || 0));
  return {
    ...d,
    ...s,
    boosters,
    locationRewardsClaimed: Array.isArray(s.locationRewardsClaimed) ? s.locationRewardsClaimed : [],
    dailyRewardLastClaim: typeof s.dailyRewardLastClaim === "string" ? s.dailyRewardLastClaim : null,
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch {
    return defaultState();
  }
}

export function saveState(state) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

export function totalStarsEarned(state) {
  return Object.values(state.starsEarned).reduce((a, b) => a + b, 0);
}

export function starsSpent(state, upgrades) {
  const built = new Set(state.upgradesBuilt);
  return upgrades.filter((u) => built.has(u.id)).reduce((sum, u) => sum + u.cost, 0);
}

export function starBank(state, upgrades) {
  return Math.max(0, totalStarsEarned(state) - starsSpent(state, upgrades));
}

export function isLevelUnlocked(levelId, state) {
  if (levelId <= 1) return true;
  return (state.starsEarned[levelId - 1] || 0) > 0;
}

export function recordLevelResult(state, levelId, stars) {
  const prev = state.starsEarned[levelId] || 0;
  if (stars > prev) state.starsEarned[levelId] = stars;
  // unlock next by virtue of having stars on current; selectedLevel moves forward
  if (stars > 0 && state.selectedLevel <= levelId) {
    state.selectedLevel = levelId + 1;
  }
}

export function buildUpgrade(state, upgradeId, upgrades) {
  if (state.upgradesBuilt.includes(upgradeId)) return false;
  const upgrade = upgrades.find((u) => u.id === upgradeId);
  if (!upgrade) return false;
  if (starBank(state, upgrades) < upgrade.cost) return false;
  state.upgradesBuilt.push(upgradeId);
  return true;
}

export function getBoosterCount(state, kind) {
  return Math.max(0, Number(state.boosters?.[kind] || 0));
}

export function spendBooster(state, kind) {
  const n = getBoosterCount(state, kind);
  if (n <= 0) return false;
  state.boosters[kind] = n - 1;
  return true;
}

export function addBoosters(state, rewards) {
  state.boosters = { ...(state.boosters || { hammer: 0, bomb: 0, shuffle: 0 }) };
  for (const [kind, amount] of Object.entries(rewards || {})) {
    if (!(kind in state.boosters)) continue;
    state.boosters[kind] = Math.max(0, Number(state.boosters[kind] || 0) + Math.max(0, Number(amount || 0)));
  }
}

export function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function canClaimDailyReward(state, now = new Date()) {
  return state.dailyRewardLastClaim !== todayKey(now);
}

export function claimDailyReward(state, now = new Date()) {
  if (!canClaimDailyReward(state, now)) return null;
  const kinds = ["hammer", "bomb", "shuffle"];
  const kind = kinds[Math.floor(Math.random() * kinds.length)];
  addBoosters(state, { [kind]: 1 });
  state.dailyRewardLastClaim = todayKey(now);
  return { kind, amount: 1 };
}

export function isLocationRewardClaimed(state, gardenId) {
  return (state.locationRewardsClaimed || []).includes(gardenId);
}

export function claimLocationReward(state, gardenId) {
  if (isLocationRewardClaimed(state, gardenId)) return null;
  const reward = { hammer: 1, bomb: 1, shuffle: 1 };
  addBoosters(state, reward);
  state.locationRewardsClaimed = [...(state.locationRewardsClaimed || []), gardenId];
  return reward;
}