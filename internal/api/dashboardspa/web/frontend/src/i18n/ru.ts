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

  // Agent roles (lib/agentNames).
  Implementer: 'Исполнитель',
  Dispatcher: 'Диспетчер',
  'Run operator': 'Оператор прогонов',

  // Supervisor events (attention/eventTitles).
  'An agent claimed work and stopped moving': 'Агент взял работу и остановился',
  'Task store maintenance failed': 'Обслуживание хранилища задач не удалось',
  'A scheduled order failed': 'Плановое поручение не выполнено',
  'A request to the city failed': 'Запрос к городу не прошёл',
  'An agent session crashed': 'Сессия агента упала',
  'An agent session ended and left work behind': 'Сессия агента закончилась и бросила работу',
  'An agent could not look up its work': 'Агент не смог найти свою работу',
  'The supervisor was asked to shut down': 'Супервизору велели остановиться',
  'The event log was rotated': 'Журнал событий перевёрнут',
  'An agent session was quarantined': 'Сессия агента на карантине',
  'An agent session was suspended': 'Сессия агента приостановлена',
  'The supervisor skipped a tick: disk is under pressure':
    'Супервизор пропустил такт: диск перегружен',

  // Owner plate (components/home/OwnerPlate).
  'Nothing waits for you right now.': 'Сейчас вас ничего не ждёт',
  'The city is running on its own.': 'Город работает сам.',
  'Checking whether anything waits for you…': 'Проверяю, ждёт ли вас что-нибудь…',
  'Could not check: {reasons}.': 'Не удалось проверить: {reasons}.',
  'Questions from the Mayor could not be read': 'вопросы Мэра не прочитались',
  'Your mail could not be read': 'почта не прочиталась',
  'Answer in chat': 'Ответить в чате',
  Open: 'Открыть',
  'Questions from the Mayor arrive in the chat.': 'Вопросы Мэра приходят в чат.',

  // Tasks in flight (components/home/TasksInFlight).
  'What is going on': 'Что идёт',
  'Reading the board…': 'Читаю доску…',
  'Nothing is going on right now': 'Сейчас ничего не идёт',
  Working: 'Пишется код',
  PR: 'Вливание',
  'Show all {n}': 'Показать все {n}',
  'Show fewer': 'Свернуть',

  // City block (components/home/CityStrip).
  Tasks: 'Задачи',
  Problems: 'Неполадки',
  'reading…': 'читаю…',
  'could not read': 'не удалось прочитать',
  '{running} of {total} working': '{running} из {total} работают',
  '{inFlight} in progress, {queued} queued': '{inFlight} в работе, {queued} в очереди',
  'Could not read: {names}': 'Не удалось прочитать: {names}',

  // Attention rows (attention/registry).
  'A task outside this view': 'Задача вне окна',
  'awaiting input': 'ждёт ответа',
  errored: 'сломался',
  'rate limited': 'упёрся в лимит',
  stalled: 'застрял',
  escalated: 'просит помощи',
  waiting: 'ждёт',
  unclaimed: 'никто не взял',

  // Plurals.
  '{n} more tasks in the queue': {
    one: 'Ещё {n} задача в очереди',
    few: 'Ещё {n} задачи в очереди',
    many: 'Ещё {n} задач в очереди',
  },
  '{n} more runs with no task on the board': {
    one: 'Ещё {n} прогон без задачи на доске',
    few: 'Ещё {n} прогона без задачи на доске',
    many: 'Ещё {n} прогонов без задачи на доске',
  },
  '{n} things wait for you': {
    one: 'Вас ждёт {n} дело',
    few: 'Вас ждут {n} дела',
    many: 'Вас ждут {n} дел',
  },
};
