const SAVE_KEY = "fairy-match3-save-v1";

function defaultState() {
  return {
    starsEarned: {},      // levelId -> 0..3
    upgradesBuilt: [],    // upgrade ids
    selectedLevel: 1,
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed };
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