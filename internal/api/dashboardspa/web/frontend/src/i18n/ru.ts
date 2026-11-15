// Russian strings keyed by the English source string (gettext style).
// A plain string is a direct translation; an object holds the three Russian
// plural forms and is looked up by `tn()` under the English `forms.other`.
//
// Vocabulary (Global Constraints, OWNER-HOME-PLAN): «задача» (bead),
// «прогон» (run), «маршрут» (route), «шаг» (step), «ворота» (gate),
// «исполнитель», «ревьюер», «Мэр», «ревью», «вливание», «доска», «город».
// Sentence case, no all caps, no middle-dot joins.

export type RuPlural = { one: string; few: string; many: string };

export const RU: Readonly<Record<string, string | RuPlural>> = {
  // Navigation rail.
  Home: 'Главная',
  Runs: 'Прогоны',
  Agents: 'Агенты',
  Beads: 'Задачи',
  Mail: 'Почта',
  Activity: 'События',
  Health: 'Здоровье',

  // Glossary.
  Bead: 'Задача',
  Run: 'Прогон',
  Route: 'Маршрут',
  Routes: 'Маршруты',
  Step: 'Шаг',
  Steps: 'Шаги',
  Gate: 'Ворота',
  Gates: 'Ворота',
  Worker: 'Исполнитель',
  Workers: 'Исполнители',
  Reviewer: 'Ревьюер',
  Reviewers: 'Ревьюеры',
  Mayor: 'Мэр',
  Review: 'Ревью',
  Merge: 'Вливание',
  Board: 'Доска',
  City: 'Город',

  // Rail (Task 9).
  'Switch city': 'Сменить город',
  '{city} (unknown)': '{city} (не найден)',
  '{city} (stopped)': '{city} (остановлен)',
  city: 'город',
  'Reading as {name}': 'Читаете как {name}',
  'Switch to light theme': 'Переключить на светлую тему',
  'Switch to dark theme': 'Переключить на тёмную тему',
  Light: 'Светлая',
  Dark: 'Тёмная',
  '{n} need you': { one: '{n} ждёт вас', few: '{n} ждут вас', many: '{n} ждут вас' },
  // The owner pill keeps the old English aria form (Mail pin); in Russian it
  // says what it means.
  '{label}: {n} attention items': {
    one: '{label}: {n} дело ждёт вас',
    few: '{label}: {n} дела ждут вас',
    many: '{label}: {n} дел ждут вас',
  },
  '{label}: {n} city issues': {
    one: '{label}: {n} неполадка города',
    few: '{label}: {n} неполадки города',
    many: '{label}: {n} неполадок города',
  },

  // Health: city issues (Task 10).
  'City issues': 'Неполадки города',
  'No city issues': 'Неполадок нет',
  'Could not read': 'Не удалось прочитать',
  'Show all {n}': { one: 'Показать все {n}', few: 'Показать все {n}', many: 'Показать все {n}' },
  'Show fewer': 'Свернуть',

  // Page titles (Task 9; PageHeader translates a known title).
  Agent: 'Агент',
  Cockpit: 'Пульт',

  // Plurals.
  '{n} things wait for you': {
    one: 'Вас ждёт {n} дело',
    few: 'Вас ждут {n} дела',
    many: 'Вас ждут {n} дел',
  },
};
