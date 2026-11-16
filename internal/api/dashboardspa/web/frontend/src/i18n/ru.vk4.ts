import type { RuPlural } from './ru';

// vk lane 4: Russian strings keyed by the English source string. Only lane 4 adds keys here.
export const RU_VK4: Readonly<Record<string, string | RuPlural>> = {
  // epics
  'No epic — fixes and small things': 'Без эпика — починки и мелочи',
  '{done} of {total}': '{done} из {total}',
  'no plan yet': 'плана ещё нет',
  // filter bar
  'Whose tasks': 'Чьи задачи',
  'Owner: all': 'Все',
  'Owner: mine': 'Мои',
  "Owner: Richard's": 'Ричарда',
  "Appears after sync with Richard's city": 'Появится после синхронизации с городом Ричарда',
  'Epic:': 'Эпик:',
  'Epic: all': 'Все',
  'Choose an epic': 'Выбрать эпик',
  'All tasks': 'Все задачи',
  'Find a task…': 'Найти задачу…',
  'New task': 'Новая задача',
  'The Mayor channel is not configured': 'Канал Мэра не настроен',
  'Writes are disabled here': 'Запись здесь выключена',
  'Could not notify the Mayor': 'Не удалось уведомить Мэра',
  // ⌘K
  'Find and go': 'Найти и перейти',
  'Find a task, epic or action': 'Найти задачу, эпик или действие',
  'Results': 'Результаты',
  'Palette: tasks': 'Задачи',
  'Palette: epics': 'Эпики',
  'Palette: actions': 'Действия',
  'Open «Needs from me»': 'Открыть «Нужно от меня»',
  'Palette: board': 'Доска',
  'Discuss with the Mayor in Discord': 'Обсудить с Мэром в Discord',
  'Nothing found': 'Ничего не найдено',
  'Palette: select': 'выбрать',
  'Palette: open': 'открыть',
  'Palette: close': 'закрыть',
  'Palette: close button': 'Закрыть',
};
