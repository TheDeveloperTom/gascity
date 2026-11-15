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
  // part 4: comments
  'Mayor of {owner}': 'Мэр {owner}',
  'My Mayor': 'Мой Мэр',
  'just now': 'только что',
  agent: 'агент',
  delivered: 'доставлено',
  'not delivered': 'не доставлено',
  'waiting for delivery': 'ждёт доставки',
  new: 'новое',
  '✓ acknowledged': '✓ принято',
  Send: 'Отправить',
  'Write something first.': 'Сначала напиши текст.',
  'Too many messages — try again in a minute.': 'Слишком много сообщений — попробуй через минуту.',
  'The card is no longer on the other board.': 'Этой карточки уже нет на доске другого города.',
  'Comments are switched off on this city.': 'Комментарии в этом городе выключены.',
  'Not sent — try again.': 'Не отправлено — попробуй ещё раз.',
  Comments: 'Комментарии',
  'your city': 'твой город',
  '{owner} city': 'город {owner}',
  'another agent': 'другой агент',
  'No comments yet.': 'Комментариев пока нет.',
  'Comment for {owner}': 'Комментарий для {owner}',
  'Write to {name}…': 'Написать {name}…',
  'Write to {owner} city…': 'Написать в город {owner}…',
  'goes to {owner} city in about a minute; their Mayor will show it':
    'уйдёт в город {owner} за ~минуту; его Мэр покажет ему',
  'A task from {owner} city, read only. Only {name} can change it; you can leave a comment.':
    'Задача из города {owner}, только для чтения. Менять её может {name}; ты можешь оставить комментарий.',
};
