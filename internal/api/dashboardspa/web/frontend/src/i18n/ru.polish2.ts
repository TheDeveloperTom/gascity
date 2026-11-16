import type { RuPlural } from './ru';

// polish2 16.11 (owner's live findings): Russian strings keyed by the English
// source string. Only the polish2 lane adds keys here, and never a key another
// dictionary already has (the merge is a spread: a later lane would override).
export const RU_POLISH2: Readonly<Record<string, string | RuPlural>> = {
  // Board scopes (item 7).
  'City (service)': 'Город (служебное)',
  '{rig} product': 'Продукт {rig}',
  // «Нужно от меня»: stalls folded under a question (item 6).
  '· {n} of them are stuck': {
    one: '· из них стоит {n}',
    few: '· из них стоят {n}',
    many: '· из них стоят {n}',
  },

  // Relative time units (formatRelative): «as of 5m» was English.
  now: 'сейчас',
  '{n}s': '{n} с',
  '{n}m': '{n} мин',
  '{n}h': '{n} ч',
  '{n}d': '{n} дн.',
  'as of {time} ago': 'данные {time} назад',
  'Partial: some sources did not load. Links may be incomplete.':
    'Не всё прочитано: часть источников не ответила, связи могут быть неполными.',

  // Card drawer.
  'This decision was resolved or removed.': 'Это решение уже принято или удалено.',
  'The task it pointed to is no longer in the supervisor — it was likely closed or pruned since this link was surfaced.':
    'Задачи, на которую вела ссылка, больше нет в супервизоре: скорее всего, её закрыли или убрали.',
  'View live run': 'Смотреть прогон вживую',

  // «Расход и нагрузка» (the folded usage panel on «Нужно от меня»).
  'Pause updates': 'Остановить обновление',
  'Resume updates': 'Продолжить обновление',
  'Some readings are unavailable: {list}.': 'Часть показаний недоступна: {list}.',
  usage: 'расход',
  'city status': 'состояние города',
  'run states': 'состояния прогонов',
  sessions: 'сессии',
  'Runs by state': 'Прогоны по состоянию',
  queued: 'в очереди',
  running: 'идут',
  stopping: 'останавливаются',
  'Right now': 'Сейчас',
  'model calls today': 'вызовов модели сегодня',
  '{cost} estimated today': 'около {cost} сегодня',
  'active sessions': 'активных сессий',
  'tokens / min': 'токенов в минуту',
  'burn · $ / hr': 'расход · $ в час',
  '24 h average': 'среднее за 24 ч',
  Usage: 'Расход',
  'Last 24 hours': 'За 24 часа',
  'tokens in': 'токенов на вход',
  'tokens out': 'токенов на выход',
  'model calls': 'вызовов модели',
  'est. cost': 'оценка стоимости',
  'waiting for the first usage sample': 'жду первый замер расхода',
  'Context window used': 'Занято окна контекста',
  'no live session context reported': 'живые сессии не сообщили о контексте',
  'loading {what}…': 'читаю: {what}…',
  '{what} unavailable': 'нет данных: {what}',
  '{what} is stale · refresh failed': '{what}: данные устарели, обновить не удалось',
  'city status is partial': 'состояние города прочитано не полностью',
  'run projection is partial': 'прогоны прочитаны не полностью',
  'session list is partial': 'список сессий неполный',
  'usage recording is not local': 'расход пишется не здесь',
  'usage recording is off': 'запись расхода выключена',
  'usage estimate is partial': 'оценка расхода неполная',
  'Recent model activity': 'Недавняя работа модели',
  '{n} samples': 'замеров: {n}',
  'collecting samples': 'собираю замеры',

  // Runs page.
  'Stages, in order: intake, implementation, review, approval, finalization.':
    'Этапы по порядку: приём, реализация, ревью, одобрение, завершение.',
  'fixture data': 'тестовые данные',
  'live data unavailable': 'живых данных нет',
  'stale {time} ago': 'устарело {time} назад',
  stale: 'устарело',
  'runs partial': 'прогоны неполные',
  "one or more rigs' recent runs were unavailable; the lane set may be incomplete":
    'недавние прогоны части проектов не прочитаны; список может быть неполным',
  'Loading formula runs.': 'Загружаю прогоны.',
  'Loading formula run lanes.': 'Загружаю прогоны.',
  "{n} active runs across the supervisor's bead store.": 'Активных прогонов: {n}.',
  'Run counts unavailable: {error}.': 'Число прогонов недоступно: {error}.',

  // Mail page.
  Compose: 'Написать',
  'Compose a new message (sends as the operator)': 'Новое письмо (уйдёт от оператора)',
  'Switch back to the operator to compose': 'Чтобы написать, вернись к оператору',
  'Search mail by sender, subject, rig': 'Поиск по отправителю, теме, проекту',
  'No messages match the current search or filter.': 'Нет писем под этот поиск или фильтр.',
  'Inbox empty for {who}.': 'У {who} входящих нет.',
  'Sent empty for {who}.': 'У {who} отправленных нет.',
  'No messages in this project.': 'В этом проекте писем нет.',
  'Loading thread.': 'Загружаю переписку.',
  Reply: 'Ответ',
  Mailbox: 'Ящик',
  'bulk mail selection': 'выбор писем',
  'select all mail': 'выбрать все письма',
  'Select all': 'Выбрать все',
  '{n} selected': 'выбрано: {n}',
  Window: 'Период',
  'Mail time window': 'Период писем',
  'Mail history limit': 'Сколько писем показать',
  'Recent {n}': 'Последние {n}',
  'New message': 'Новое письмо',
  'Sends from the operator. Reading-as has no effect on the sender.':
    'Уйдёт от оператора. «Читаю как» отправителя не меняет.',
  Sending: 'Отправляю',
  From: 'От',
  'To (alias)': 'Кому (имя)',
  Subject: 'Тема',

  // Shell, bootstrap, errors.
  'config unavailable:': 'настройки недоступны:',
  'some controls may be disabled until it loads.': 'часть кнопок может не работать, пока они не загрузятся.',
  'Page not found': 'Страница не найдена',
  'No dashboard route matches this path.': 'По этому адресу ничего нет.',
  'Resolving city…': 'Открываю город…',
  'City «{city}» is not registered on this supervisor.': 'Город «{city}» не зарегистрирован в этом супервизоре.',
  'Available cities:': 'Доступные города:',
  'No cities are registered on this supervisor.': 'В этом супервизоре нет ни одного города.',
  'Dashboard view failed.': 'Страница упала.',
  'The error was reported to the local dashboard log. Refresh to retry this view.':
    'Ошибка записана в журнал. Обнови страницу, чтобы попробовать снова.',
  'Working now': 'Работают сейчас',
  Dismiss: 'Скрыть',
  'Read-only': 'Только чтение',
  Attention: 'Внимание',
  Peek: 'Посмотреть',
  'Worker status unavailable.': 'Состояние исполнителей недоступно.',
  'Checking worker status…': 'Проверяю исполнителей…',
  'No workers active right now.': 'Сейчас никто не работает.',
  'This task is a recipe, not work to do: every {name} instance is made from it. Its «in progress» status means «available for instantiation» — do not act on it, nudge it or close it.':
    'Это рецепт, а не работа: из него делается каждый экземпляр {name}. Статус «в работе» значит «можно запускать»; не трогай, не подталкивай и не закрывай её.',
  'One run of the {name} recipe.': 'Один прогон рецепта {name}.',

  // Card drawer, one screen (item 8).
  'part of': 'часть',
  nobody: 'нет',
  'Executor: {who}': 'Исполнитель: {who}',
  'created {date}': 'создана {date}',
  Sessions: 'Сессии',
  'Pull requests': 'Пул-реквесты',
  Issues: 'Задачи GitHub',
  'Formula runs': 'Прогоны',
  'Order runs': 'Прогоны по расписанию',
  Description: 'Описание',
  Recipe: 'Рецепт',
};
