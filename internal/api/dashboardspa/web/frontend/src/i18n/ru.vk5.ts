import type { RuPlural } from './ru';

// vk lane 5: Russian strings keyed by the English source string. Only lane 5 adds keys here.
export const RU_VK5: Readonly<Record<string, string | RuPlural>> = {
  'Needs from me': 'Нужно от меня',
  'Needs from me, {n}': 'Нужно от меня, {n}',
  Board: 'Доска',
  Search: 'Поиск',
  Sections: 'Разделы',
  'All pages': 'Все страницы',
  More: 'Ещё',
  'updated {time}': 'обновлено {time}',
  'devwork product': 'Продукт devwork',
  'The city itself': 'Сам город',
  You: 'Ты',
};
