export const TILE_TYPES = [
  { id: 0, key: "rose",   gem: "🌸", name: "Роза" },
  { id: 1, key: "sun",    gem: "☀️", name: "Солнышко" },
  { id: 2, key: "leaf",   gem: "🍃", name: "Листок" },
  { id: 3, key: "drop",   gem: "💎", name: "Капля" },
  { id: 4, key: "moon",   gem: "🔮", name: "Аметист" },
  { id: 5, key: "berry",  gem: "🍓", name: "Ягода" },
];

export const LEVELS = [
  {
    id: 1,
    title: "Пробуждение росы",
    story: "Фея Люмина просыпается в увядшем саду. Собери первые волшебные росинки, чтобы оживить цветочную поляну.",
    moves: 20,
    goal: { type: "score", target: 800 },
    starThresholds: [800, 1400, 2000],
  },
  {
    id: 2,
    title: "Шёпот ручья",
    story: "Под слоем тумана слышен ручей. Собери капли воды, чтобы он снова зазвенел по камешкам.",
    moves: 22,
    goal: { type: "collect", tile: 3, target: 18 },
    starThresholds: [1000, 1700, 2400],
  },
  {
    id: 3,
    title: "Солнечная поляна",
    story: "Без света цветы не распустятся. Собери солнышки и развей серый туман над поляной.",
    moves: 24,
    goal: { type: "collect", tile: 1, target: 22 },
    starThresholds: [1200, 2000, 2800],
  },
  {
    id: 4,
    title: "Ягодная тропа",
    story: "Лесные зверята голодают. Наполни корзины ягодами, и они помогут тебе в пути.",
    moves: 24,
    goal: { type: "collect", tile: 5, target: 24 },
    starThresholds: [1400, 2200, 3200],
  },
  {
    id: 5,
    title: "Лунный фонтан",
    story: "Древний фонтан уснул. Аметисты хранят его магию — собери их, чтобы вода снова забила вверх.",
    moves: 26,
    goal: { type: "collect", tile: 4, target: 26 },
    starThresholds: [1600, 2600, 3600],
  },
  {
    id: 6,
    title: "Сад в цвету",
    story: "Последний рубеж: Серые Шёпоты цепляются за сад. Собери достаточно магии, чтобы рассеять туман навсегда.",
    moves: 28,
    goal: { type: "score", target: 3500 },
    starThresholds: [3500, 5000, 6500],
  },
];

export const UPGRADES = [
  {
    id: "flowers",
    name: "Цветочная поляна",
    desc: "Возвращает яркие цветы на лужайку у входа в сад.",
    cost: 2,
    icon: "🌷",
    sceneStyle: { left: "12%", bottom: "18%", fontSize: "2.4rem" },
  },
  {
    id: "stream",
    name: "Волшебный ручей",
    desc: "Очищает ручей — вода снова приносит жизнь саду.",
    cost: 3,
    icon: "💧",
    sceneStyle: { left: "42%", bottom: "12%", fontSize: "2.2rem" },
  },
  {
    id: "tree",
    name: "Древо Света",
    desc: "Пробуждает древнее дерево, которое освещает окрестности.",
    cost: 4,
    icon: "🌳",
    sceneStyle: { right: "14%", bottom: "22%", fontSize: "3rem" },
  },
  {
    id: "fountain",
    name: "Лунный фонтан",
    desc: "Восстанавливает сердце сада и его магическую силу.",
    cost: 4,
    icon: "⛲",
    sceneStyle: { left: "44%", bottom: "28%", fontSize: "2.5rem" },
  },
  {
    id: "rainbow",
    name: "Радуга над садом",
    desc: "Финальное чудо: радуга рассеивает остатки тумана.",
    cost: 5,
    icon: "🌈",
    sceneStyle: { left: "28%", top: "8%", fontSize: "3.2rem" },
  },
];

export const STORY_INTRO =
  "Туман Серых Шёпотов укрыл волшебный Сад Чудес. Помоги фее Люмине: проходи уровни 3 в ряд, собирай звёзды и трать их, чтобы вернуть саду жизнь.";