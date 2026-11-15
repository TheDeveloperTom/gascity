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

  // Plurals.
  '{n} things wait for you': {
    one: 'Вас ждёт {n} дело',
    few: 'Вас ждут {n} дела',
    many: 'Вас ждут {n} дел',
  },
};
