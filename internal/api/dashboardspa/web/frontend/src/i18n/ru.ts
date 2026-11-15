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
  All: 'Все',
  'No stage': 'Без этапа',

  // Rail (Task 9).
  'Switch city': 'Сменить город',
  '{city} (unknown)': '{city} (не найден)',
  '{city} (stopped)': '{city} (остановлен)',
  city: 'город',
  'Reading as {name}': 'Вы смотрите почту как {name}',
  'Switch language to Russian (RU)': 'Переключить язык на русский (RU)',
  'Switch language to English (EN)': 'Переключить язык на английский (EN)',
  'Switch to light theme': 'Переключить на светлую тему',
  'Switch to dark theme': 'Переключить на тёмную тему',
  Light: 'Светлая',
  Dark: 'Тёмная',
  '{n} need you': {
    one: '{n} дело ждёт вас',
    few: '{n} дела ждут вас',
    many: '{n} дел ждут вас',
  },
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
  'Reading the state of the city…': 'Читаю состояние города…',
  'Could not read': 'Не удалось прочитать',

  // Page titles (Task 9; PageHeader translates a known title).
  Agent: 'Агент',
  Cockpit: 'Пульт',
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
  'Questions from the Mayor were read only in part': 'вопросы Мэра прочитались не полностью',
  'Your mail was read only in part': 'почта прочиталась не полностью',
  'Your settings could not be read': 'настройки не прочитались',
  // City readiness reasons (attention/liveContributors deriveCityReadiness).
  'Agents could not be read': 'агенты не прочитались',
  'Tasks could not be read': 'задачи не прочитались',
  'Runs could not be read': 'прогоны не прочитались',
  'Events could not be read': 'события не прочитались',
  'City health could not be read': 'здоровье города не прочиталось',
  'Answer in chat': 'Ответить в чате',
  Open: 'Открыть',
  'Questions from the Mayor arrive in the chat.': 'Вопросы Мэра приходят в чат.',

  // Tasks in flight (components/home/TasksInFlight).
  'What is going on': 'Что идёт',
  'Reading the board…': 'Читаю доску…',
  'Could not read the board': 'Не удалось прочитать доску',
  'Nothing is going on right now': 'Сейчас ничего не идёт',
  'Writing code': 'Пишется код',
  Merging: 'Вливание',
  'Show all {n}': 'Показать все {n}',

  // City block (components/home/CityStrip).
  Tasks: 'Задачи',
  Problems: 'Неполадки',
  'reading…': 'читаю…',
  'could not read': 'не удалось прочитать',
  '{running} of {total} working': '{running} из {total} работают',
  '{inFlight} in progress, {queued} queued': '{inFlight} в работе, {queued} в очереди',
  'Could not read: {names}': 'Не удалось прочитать: {names}',

  // Home (routes/CockpitHome).
  'Usage and load': 'Расход и нагрузка',
  'City status': 'Состояние города',
  'City status is stale': 'Состояние города устарело',
  'City status is partial': 'Состояние города прочитано не полностью',
  'Live updates are disconnected': 'Живые обновления отключены',
  'Live updates are degraded': 'Живые обновления работают с перебоями',
  'Task store maintenance is overdue': 'Обслуживание хранилища задач просрочено',

  // Attention row summaries (attention/rowCopy).
  'someone outside the city': 'кого-то вне города',
  'nobody is on it': 'никто не взялся',
  '{who} has no live session': 'у {who} нет живой сессии',
  'the session ended': 'сессия закончилась',
  'the session is {state}': 'сессия в состоянии {state}',
  'Asks for help': 'Просит помощи',
  'Nobody has taken it for {age}': 'Никто не берёт уже {age}',
  'On hold': 'На паузе',
  'On hold for {age}': 'На паузе уже {age}',
  'Waiting on you': 'Ждёт вас',
  'Waiting on you for {age}': 'Ждёт вас уже {age}',
  'Waiting on {who}': 'Ждёт: {who}',
  'Waiting on {who} for {age}': 'Ждёт: {who}, уже {age}',
  'Stalled: {cause}': 'Застряла: {cause}',
  'Stalled for {age}: {cause}': 'Застряла {age}: {cause}',

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
  '{n} hours': { one: '{n} час', few: '{n} часа', many: '{n} часов' },
  '{n} days': { one: '{n} день', few: '{n} дня', many: '{n} дней' },
  '{n} agents quarantined': {
    one: '{n} агент на карантине',
    few: '{n} агента на карантине',
    many: '{n} агентов на карантине',
  },
  '{n} agents suspended': {
    one: '{n} агент приостановлен',
    few: '{n} агента приостановлены',
    many: '{n} агентов приостановлены',
  },
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

  // The board as a route (B5).
  Stages: 'Этапы',
  Waiting: 'Ждёт',
  Working: 'В работе',
  PR: 'PR',
  Merged: 'Влито',
  recent: 'недавние',
  None: 'Пусто',
  'Show {n} more': 'Ещё {n}',
  'Show fewer': 'Свернуть',
  'Show all history': 'Вся история',
  'Recent merges only': 'Только недавние',
  'Nobody is working right now.': 'Сейчас никто не работает.',
  'No reason found in the board data.': 'Причину в данных доски найти не удалось.',
  'The board read only part of the tasks, so it cannot tell who is working.':
    'Доска прочитала не все задачи, поэтому не может сказать, кто работает.',
  'Open the run': 'Открыть прогон',

  // Cards in plain Russian (B6).
  'ready to take': 'можно брать',
  Queued: 'в очереди',
  'waits for {n} tasks': {
    one: 'ждёт {n} задачу',
    few: 'ждёт {n} задачи',
    many: 'ждёт {n} задач',
  },
  'waits for a decision: «{title}»': 'ждёт решения: «{title}»',
  'waits for another task': 'ждёт другую задачу',
  'holds {n} tasks': {
    one: 'держит {n} задачу',
    few: 'держит {n} задачи',
    many: 'держит {n} задач',
  },
  blocked: 'заблокирована',
  stopped: 'остановлена',
  'route failed': 'прогон упал',
  'route stopped': 'прогон остановился',
  'TDD refused': 'нет красного теста',
  'closed, not merged': 'закрыта без вливания',
  'merged {when}': 'влито {when}',
  'today at {time}': 'сегодня в {time}',
  'yesterday at {time}': 'вчера в {time}',
  'Select {id}': 'Открыть задачу {id}',
  'Open run {id}': 'Открыть прогон {id}',
  'Open step {id} in its run': 'Открыть шаг {id} в прогоне',

  // The Beads page (B7).
  'New bead': 'Новая задача',
  Refresh: 'Обновить',
  Refreshing: 'Обновляю',
  Loading: 'Загружаю',
  Project: 'Проект',
  'Search beads': 'Найти задачу',
  'Find a task by title, id, label or assignee': 'Название, номер, метка или исполнитель',
  'Show test tasks ({n})': 'Показать тестовые ({n})',
  'The board read {fetched} of {total} records; some work may be missing.':
    'Доска прочитала {fetched} из {total} записей; часть работы может не попасть на неё.',
  'Closed {id}.': 'Задача {id} закрыта.',
  'Created {id} and slung to {agent}.': 'Задача {id} создана и отдана {agent}.',
  'close failed': 'не удалось закрыть',
  'create and sling failed': 'не удалось создать и отдать',
  'Loading beads.': 'Загружаю задачи.',
  'No tasks match the search or filter.': 'Ничего не нашлось.',
  'Nothing on the board right now.': 'Доска пуста.',
  '{n} runs are not tied to a task on this board.': {
    one: '{n} прогон без задачи на доске.',
    few: '{n} прогона без задачи на доске.',
    many: '{n} прогонов без задачи на доске.',
  },
  closing: 'закрываю',
  'Close bead…': 'Закрыть задачу…',
  'Close bead': 'Закрыть задачу',
  'Close {id}': 'Закрыть {id}',
  Cancel: 'Отмена',
  'Close this bead? It will be marked closed and drop out of the open queue.':
    'Закрыть задачу? Она будет отмечена закрытой и уйдёт из очереди.',
  'Create and sling': 'Создать и отдать',
  Creating: 'Создаю',
  Title: 'Название',
  Body: 'Описание',
  Rig: 'Риг',
  'all rigs': 'все риги',

  // Needs-you panels (Task 11).
  'Needs you': 'Вас ждёт',
  '{n} to watch': 'Присмотреть: {n}',
  '{n} task issues are on Health': {
    one: 'Неполадки задач: {n}',
    few: 'Неполадки задач: {n}',
    many: 'Неполадки задач: {n}',
  },

  // Why work waits (B3).
  '{n} tasks of stage {milestone} wait for card {id}': {
    one: '{n} задача этапа {milestone} ждёт карточку {id}',
    few: '{n} задачи этапа {milestone} ждут карточку {id}',
    many: '{n} задач этапа {milestone} ждут карточку {id}',
  },
  '{n} tasks of the run wait for card {id}': {
    one: '{n} задача прогона ждёт карточку {id}',
    few: '{n} задачи прогона ждут карточку {id}',
    many: '{n} задач прогона ждут карточку {id}',
  },
  '{n} tasks wait for a decision: «{title}»': {
    one: '{n} задача ждёт решения: «{title}»',
    few: '{n} задачи ждут решения: «{title}»',
    many: '{n} задач ждут решения: «{title}»',
  },
  '{n} tasks of stage {milestone} are queued; none has started': {
    one: '{n} задача этапа {milestone} в очереди и ещё не начата',
    few: '{n} задачи этапа {milestone} в очереди, ни одна ещё не начата',
    many: '{n} задач этапа {milestone} в очереди, ни одна ещё не начата',
  },
  '{n} tasks of the run are queued; none has started': {
    one: '{n} задача прогона в очереди и ещё не начата',
    few: '{n} задачи прогона в очереди, ни одна ещё не начата',
    many: '{n} задач прогона в очереди, ни одна ещё не начата',
  },
  'No runs are going. {n} tasks are ready to take.': {
    one: 'Запущенных прогонов нет. Можно брать {n} задачу.',
    few: 'Запущенных прогонов нет. Можно брать {n} задачи.',
    many: 'Запущенных прогонов нет. Можно брать {n} задач.',
  },

  // Dashboard v3, Task 1: the shared data and copy layer. After Task 1 this
  // file does not change; lanes add keys to ru.home / ru.board / ru.debug.

  // Durations and ages (lib/engineText, lib/boardFacts).
  '{n} ms': '{n} мс',
  '{n} s': '{n} с',
  '{n} min': '{n} мин',
  '{n} h': '{n} ч',
  '{n} d': '{n} дн.',

  // Engine text (lib/engineText, ruling V7).
  'The scheduled order did not finish within {d}': 'Плановое поручение не уложилось в {d}',
  'The {rig} task store did not answer within {d}': 'База задач {rig} не ответила за {d}',
  'waits for the PR to merge': 'ждёт вливания PR',
  'Repair PR #{n}': 'Починить PR #{n}',
  'Repair PR #{n}: {reason}': 'Починить PR #{n}: {reason}',
  'merge conflict': 'конфликт слияния',
  'checks failed': 'проверки не прошли',
  'review asked for changes': 'ревью просит правок',
  'Repairing PR #{n}': 'Чинит PR #{n}',
  'merged into {branch}': 'влито в {branch}',
  'stalled, {detail}': 'стоит, {detail}',
  'stalled {age}, {detail}': 'стоит {age}, {detail}',
  'nobody took it': 'никто не взял',
  'the agent stopped': 'агент остановился',
  'no activity for {age}': 'нет движения {age}',
  '{who} is not running': '{who} не на связи',
  'nobody takes it for {age}': 'никто не берёт {age}',
  'did not answer within {d}': 'не ответил за {d}',
  'The city reported an error': 'Город сообщил об ошибке',
  'more details': 'подробнее',

  // Board facts (lib/boardFacts, rulings V1, V2, V4).
  'Its run stopped; the task stays open for {age}': 'Работа остановилась, задача открыта уже {age}',
  'Waiting for a PR, no movement for {age}': 'Ждёт PR, нет движения {age}',
  'owner question without a link — the Mayor must ask again':
    'вопрос владельцу без ссылки — Мэр должен переспросить',
  'PR #{n} is open, nobody is on it for {age}': 'PR #{n} открыт, никто не ведёт {age}',
  'PR #{n}: no movement for {age}': 'PR #{n}: нет движения {age}',
  'In review, no movement for {age}': 'На ревью, нет движения {age}',
  'In progress, nobody is on it for {age}': 'В работе, никто не ведёт {age}',
  'In progress, no movement for {age}': 'В работе, нет движения {age}',
  'Nobody took it, and «{title}» waits for it': 'Никто не взял, а её ждёт «{title}»',
  'Nobody took it, and {n} tasks wait for it': {
    one: 'Никто не взял, а её ждёт {n} задача',
    few: 'Никто не взял, а её ждут {n} задачи',
    many: 'Никто не взял, а её ждут {n} задач',
  },
  '{n} tasks of stage {milestone} wait for «{title}»': {
    one: '{n} задача этапа {milestone} ждёт «{title}»',
    few: '{n} задачи этапа {milestone} ждут «{title}»',
    many: '{n} задач этапа {milestone} ждут «{title}»',
  },
  '{n} tasks wait for «{title}»': {
    one: '{n} задача ждёт «{title}»',
    few: '{n} задачи ждут «{title}»',
    many: '{n} задач ждут «{title}»',
  },
  '{n} tasks are queued; none has started': {
    one: '{n} задача в очереди и ещё не начата',
    few: '{n} задачи в очереди, ни одна ещё не начата',
    many: '{n} задач в очереди, ни одна ещё не начата',
  },
  'The task queue': 'Очередь задач',
  'The queue of stage {milestone}': 'Очередь этапа {milestone}',

  // City verdict (lib/cityVerdict, ruling V9).
  'The city is working.': 'Город работает.',
  'The city is working, but answering slowly.': 'Город работает, но отвечает медленно.',
  'The city is not answering': 'Город не отвечает',
  'The city is not answering since {time}': 'Город не отвечает с {time}',
  working: 'работает',
  'answering slowly': 'отвечает медленно',
  'not answering': 'не отвечает',
  'not answering since {time}': 'не отвечает с {time}',
  '{n} cores': { one: '{n} ядре', few: '{n} ядрах', many: '{n} ядрах' },
  'overloaded: load {load} on {cores}': 'перегружен: нагрузка {load} при {cores}',
  'Mac is overloaded: load {load} on {cores}': 'Mac перегружен: нагрузка {load} при {cores}',
  '{line}, some data cannot be read in time.': '{line}, часть данных не успевает прочитаться.',
  'low memory: {pct}% free': 'мало памяти: свободно {pct}%',
  'Mac is low on memory: {pct}% free.': 'На Mac мало памяти: свободно {pct}%.',
  normal: 'в норме',
  'no data': 'нет данных',
  'in order': 'в порядке',
  'maintenance is overdue': 'обслуживание запаздывает',
  'maintenance failed': 'обслуживание не удалось',
  'Maintenance of the task store failed': 'Обслуживание базы задач не удалось',
  '{n} agents are quarantined': {
    one: '{n} агент на карантине',
    few: '{n} агента на карантине',
    many: '{n} агентов на карантине',
  },
  'The Mayor is not running since {time}': 'Мэр не запущен с {time}',

  // What an agent is doing now (lib/agentNow, ruling V6).
  'running a command': 'выполняет команду',
  'writing file {file}': 'пишет файл {file}',
  'writing a file': 'пишет файл',
  'editing file {file}': 'правит файл {file}',
  'editing a file': 'правит файл',
  'reading file {file}': 'читает файл {file}',
  'using tool {name}': 'работает с {name}',
  'using a tool': 'работает с инструментом',
  thinking: 'думает',
};
