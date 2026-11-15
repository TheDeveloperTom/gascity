import type { RuPlural } from './ru';

// vk-final lane: Russian strings keyed by the English source string.
export const RU_VKFINAL: Readonly<Record<string, string | RuPlural>> = {
  // part 2: projects
  'Project:': 'Проект:',
  'Choose a project': 'Выбрать проект',
  // part 3: the peer's board («Ричарда»); {owner} is the genitive
  'as of {time}': 'на {time}',
  'Card of {owner}': 'Карточка {owner}',
  'Data from {owner} city as of this time': 'Данные из города {owner} на это время',
  '{owner} Mac is offline since {time}': 'Мак {owner} не на связи с {time}',
  'The other city’s board could not be read.': 'Доску другого города не удалось прочитать.',
  'read only': 'только чтение',
  'A task from {owner} city, read only. Only {name} can change it.':
    'Задача из города {owner}, только для чтения. Менять её может {name}.',
  '{n} comments': 'Комментарии: {n}',
};
