import type { RuPlural } from './ru';

// vk11 card lane (16.11): strings the canvas card adds. Only this lane adds
// keys here, and never a key another dictionary already has.
export const RU_VK11CARD: Readonly<Record<string, string | RuPlural>> = {
  'waits for you': 'ждёт тебя',
  // owner 17.11: a card's main avatar is whose it is; who works now is apart
  'Owner: yours': 'Чья задача: твоя',
  'Owner: {whose}': 'Чья задача: {whose}',
  'Working now: {who}': 'Сейчас работает: {who}',
  'Whose task': 'Чья задача',
  'Working on it now': 'Сейчас работает',
  'Nobody works on it now': 'Сейчас никто не работает',
  // owner 17.11: a filter that leaves the board empty says why
  'No tasks in this filter right now': 'В этом фильтре сейчас нет задач',
  'The city of {whose} sends no tasks right now · connection live, updated {time}':
    'Город {whose} сейчас не передаёт ни одной задачи · связь живая, обновлено {time}',
  'The city of {whose} sends no tasks right now · updated {time}':
    'Город {whose} сейчас не передаёт ни одной задачи · обновлено {time}',
  'No connection to the city of {whose}: {error}': 'Нет связи с городом {whose}: {error}',
  'reconnecting': 'переподключаемся',
  'the city is offline': 'город не в сети',
  'Who you are: not read': 'кто ты — не прочиталось',
  "Owner: neighbour's": 'Соседа',
  "Appears after sync with the neighbour's city": 'Появится после синхронизации с городом соседа',
};
