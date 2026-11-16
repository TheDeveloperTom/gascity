import type { RuPlural } from './ru';

// vk11 card lane (16.11): strings the canvas card adds. Only this lane adds
// keys here, and never a key another dictionary already has.
export const RU_VK11CARD: Readonly<Record<string, string | RuPlural>> = {
  'waits for you': 'ждёт тебя',
  'Assignee: you': 'Исполнитель: ты',
  'Assignee: {who}': 'Исполнитель: {who}',
  'Assignee: Richard': 'Исполнитель: Ричард',
  'Who you are: not read': 'кто ты — не прочиталось',
  "Owner: neighbour's": 'Соседа',
  "Appears after sync with the neighbour's city": 'Появится после синхронизации с городом соседа',
};
