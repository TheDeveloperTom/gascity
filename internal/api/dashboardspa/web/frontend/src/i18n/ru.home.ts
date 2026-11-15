import type { RuPlural } from './ru';

// Lane A (Главная): Russian strings for the owner home page, keyed by the
// English source string. Only lane A adds keys here (Global Constraints).
// vk lane 3 («Нужно от меня») adds its keys below.

export const RU_HOME: Readonly<Record<string, string | RuPlural>> = {
  'Needs from me': 'Нужно от меня',
  'At work': 'Работает',
  Quiet: 'Тихо',
  Stuck: 'Стоит',
  'waiting their turn or for another task': 'ждут своей очереди или другую задачу',
  'Nothing needs you right now.': 'Сейчас от тебя ничего не нужно.',
  'Nothing is waiting quietly.': 'Тихо ждущих задач нет.',
  'The Mayor asks': 'Мэр спрашивает',
  'waits for you {time}': 'ждёт тебя {time}',
  'stuck for {time}': 'стоит {time}',
  'Options from the Mayor': 'Варианты из вопроса Мэра',
  'What waits for this': 'Что ждёт этот ответ',
  // 'holds {n} tasks' lives in the core ru.ts (same forms); no lane override.
};
