import type { RuPlural } from './ru';

// Lane B («Задачи» and the card window): Russian strings keyed by the English
// source string. Only lane B adds keys here (Global Constraints).
// vk lane 1 (board + card) adds the VK board keys below.

export const RU_BOARD: Readonly<Record<string, string | RuPlural>> = {
  'Merged · last 7 days': 'Влито · за 7 дней',
  'Show older': 'Показать старые',
  'Hide older': 'Скрыть старые',
  'needs you': 'нужен ты',
  urgent: 'срочно',
  'stalled {age}': 'стоит {age}',
  'waits for:': 'ждёт:',
  'blocks:': 'блокирует:',
  'agent at work': 'агент работает',
  'Board columns': 'Колонки доски',
  'Priority: {level}': 'Приоритет: {level}',
  'priority urgent': 'срочный',
  'priority high': 'высокий',
  'priority medium': 'средний',
  'priority low': 'низкий',
  'Nothing here': 'Здесь пусто',
  // VK 1:1 (16.11): page title fallback and the column «+» button.
  'All projects': 'Все проекты',
  'Find a task': 'Найти задачу',
  '{matched} of {total}': '{matched} из {total}',
  'Add to «{column}»': 'Добавить в «{column}»',
};
