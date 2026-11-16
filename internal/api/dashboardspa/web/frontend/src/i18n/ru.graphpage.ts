import type { RuPlural } from './ru';

// Graph sprint 16.11, page lane: «Доска | Граф», the drawer's chain rows and
// the «Показать на графе» button. Only the page lane adds keys here.
export const RU_GRAPHPAGE: Readonly<Record<string, string | RuPlural>> = {
  View: 'Вид',
  Graph: 'Граф',
  'Data still loading…': 'данные догружаются…',
  'The city is restarting… data will appear in a minute': 'Город перезапускается… данные появятся через минуту',
  'Graph filter': 'Фильтр графа',
  Everything: 'всё',
  'Only what holds me': 'только то, что держит меня',
  'Only stuck': 'только стоящее',
  'Only in work': 'только в работе',
  'Show on graph': 'Показать на графе',
  'Why it stands': 'Почему стоит',
  'Waiting on it': 'Её ждут',
  'you came from here': 'ты пришёл отсюда',
  'nobody waits': 'никто',
  'nothing, it can go': 'ничего, может идти',
  '{n} tasks in the way': {
    one: '{n} задача',
    few: '{n} задачи',
    many: '{n} задач',
  },
  '{now} right away': '{now} сразу',
  '{now} right away, {more} more further': '{now} сразу, ещё {more} дальше',
  'holds {n} tasks: show the chain on the graph': 'показать цепочку на графе',
  'Chain: {label} · {n} tasks': {
    one: 'Цепочка: {label} · {n} задача',
    few: 'Цепочка: {label} · {n} задачи',
    many: 'Цепочка: {label} · {n} задач',
  },
  '← full graph': '← весь граф',
};
