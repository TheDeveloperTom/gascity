import type { RuPlural } from './ru';

// vk lane 2: Russian strings keyed by the English source string. Only lane 2 adds keys here.
export const RU_VK2: Readonly<Record<string, string | RuPlural>> = {
  // DiscussButton
  'Discuss in Discord': 'Обсудить в Discord',
  'Other — discuss in Discord': 'Другое — обсудить в Discord',
  'Handing it to the Mayor…': 'Передаю Мэру…',
  'Opened in Discord': 'Открыто в Discord',
  'Did not work — try again': 'Не вышло — ещё раз',
  'Mayor channel is not configured': 'Канал Мэра не настроен',
  // Task drawer
  Close: 'Закрыть',
  Details: 'Подробности',
  Task: 'Задача',
  'Fetching the task.': 'Загружаю задачу.',
  'No task.': 'Задачи нет.',
  'This task was resolved or removed.': 'Эта задача уже решена или удалена.',
  'needs you': 'нужен ты',
  'Waiting on: {tags}': 'ждёт: {tags}',
  'Waiting on nothing': 'ничего не ждёт',
  'status.open': 'Открыта',
  'status.in_progress': 'В работе',
  'status.blocked': 'Заблокирована',
  'status.closed': 'Готово',
  'status.deferred': 'Отложена',
  // Question card
  'Discuss with the Mayor': 'Обсудить с Мэром',
  'What happened': 'Что случилось',
  'Answer in Discord': 'Ответить в Discord',
  chosen: 'выбрано',
  History: 'История',
  'Mayor question · answered: {choice} · just now': 'Вопрос Мэра · отвечено: {choice} · только что',
  // Relationships
  Relationships: 'Связи',
  'holds {n}': 'держит {n}',
  blocks: 'блокирует',
  'waits on': 'ждёт',
  'and {n} more': 'и ещё {n}',
  'No links.': 'Связей нет.',
  // Agent work
  'Agent work': 'Работа агентов',
  'No agent is on this task.': 'Агента на задаче нет.',
  'Reading what it does…': 'Смотрю, что он делает…',
  'Unknown right now': 'Сейчас неизвестно',
  'Watch what it writes': 'Смотреть, что пишет',
  // vk-1to1 drawer (canvas Main right panel)
  'Open task': 'Открытая задача',
  'Copy link': 'Скопировать ссылку',
  'PR #{n}': 'PR #{n}',
  Subtask: 'Подзадача',
  Epic: 'Эпик',
  'Stage package': 'Пакет этапа',
  'Message to the Mayor about this task': 'Сообщение Мэру про эту задачу',
  'For example: «why is it stuck?» or «put it off till tomorrow»':
    'Например: «почему стоит?» или «отложи до завтра»',
  'Goes to the Mayor in Discord': 'Уйдёт Мэру в Discord',
  'updated just now': 'обновлено сейчас',
  'updated {n} min ago': 'обновлено {n} мин назад',
  'updated {n} h ago': 'обновлено {n} ч назад',
  'queued, starts after the current session': 'в очереди, начнётся после текущей сессии',
};
