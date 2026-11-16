import type { GraphModel, GraphNode } from './model';

// The M04 epic of the approved mockups (Graph-Epic / V1 / V5), as a GraphModel.

function n(
  id: string,
  kind: GraphNode['kind'],
  label: string,
  title: string,
  column: number,
  row: number,
  extra: Partial<GraphNode> = {},
): GraphNode {
  return {
    id,
    kind,
    label,
    title,
    state: kind === 'question' ? 'waits_owner' : 'waits_task',
    reason: '',
    holds: 0,
    column,
    row,
    outside: false,
    assignee: null,
    ...extra,
  };
}

export const M04: GraphModel = {
  headline: 'M04: 5 из 14 закрыто. Всё дальше стоит за M04 #3.3: она ждёт M03 T6 и PR #580.',
  subline:
    'Без причины не стоит ничего: всё, что сейчас не в работе, ждёт твоих ответов — они слева, в колонке «От тебя».',
  columns: [
    { title: 'От тебя', count: 4, verdict: '4 вопроса · больше всех держит окно L1', alarm: false },
    { title: 'Сейчас', count: 3, verdict: 'в работе 1 из 3 · 2 ждут твоих ответов', alarm: false },
    { title: 'Следом', count: 1, verdict: 'ждёт M04 #3 и M03 T6', alarm: false },
    { title: 'Потом', count: 7, verdict: '7 пойдут параллельно после M04 #3.3', alarm: false },
    { title: 'Ещё позже', count: 1, verdict: 'ждёт M04 #1', alarm: false },
    { title: 'В конце', count: 1, verdict: 'приёмка ждёт всё, что левее', alarm: false },
  ],
  nodes: [
    n('qv3', 'question', 'вопрос · ВВ-3', 'Траты около $7.3', 0, 0, { holds: 2 }),
    n('qv4', 'question', 'вопрос · ВВ-4', 'Миграция 0426', 0, 1, { holds: 11 }),
    n('ql1', 'question', 'вопрос · L1', 'Окно L1 и ключ Clerk', 0, 2, { holds: 22 }),
    n('qv6', 'question', 'вопрос · ВВ-6', 'Как платит клиент', 0, 3, { holds: 1 }),
    n('s9', 'task', 'M04 страны', 'Разделить страны', 1, 0, { state: 'waits_owner', reason: 'ждёт тебя: ВВ-3' }),
    n('m3', 'task', 'M04 #3', 'Пересчёт при правках', 1, 1, {
      state: 'in_work',
      reason: 'ждёт тебя: ВВ-4',
      assignee: 'Исполнитель',
      holds: 10,
    }),
    n('t6', 'task', 'M03 T6', 'Допуск по своему ящику', 1, 2, {
      state: 'waits_owner',
      reason: 'ждёт тебя: окно L1',
      outside: true,
      holds: 10,
    }),
    n('s3', 'task', 'M04 #3.3', 'Не затирать оценку', 2, 0, { reason: 'ждёт: M04 #3, M03 T6', holds: 9 }),
    n('s1', 'task', 'M04 #3.1', 'Смена вакансии', 3, 0, { reason: 'ждёт: M04 #3.3' }),
    n('s4', 'task', 'M04 #3.4', 'Оценка ждущей подачи', 3, 1, { reason: 'ждёт: M04 #3.3' }),
    n('s6', 'task', 'M04 #5.6', 'Ручные записи оценки', 3, 2, { reason: 'ждёт: M04 #3.3' }),
    n('s7', 'task', 'M04 #5.7', 'Удаление заглушек', 3, 3, { reason: 'ждёт: M04 #3.3' }),
    n('s8', 'task', 'M04 #5.8', 'Чтение из снимка', 3, 4, { reason: 'ждёт: M04 #3.3' }),
    n('e5', 'task', 'M04 5E', 'Мост досье для подбора', 3, 5, { reason: 'ждёт: M04 #3.3' }),
    n('a1', 'task', 'M04 #1', 'Перенести расчёт', 3, 6, { reason: 'ждёт: M04 #3.3', holds: 2 }),
    n('gw', 'task', 'M04 шлюз', 'Шлюз LLM для векторов', 4, 0, { reason: 'ждёт: M04 #1' }),
    n('acc', 'task', 'M04 приёмка', 'Приёмка этапа', 5, 0, { reason: 'ждёт: всё, что левее' }),
  ],
  edges: [
    { from: 'qv3', to: 's9' },
    { from: 'qv4', to: 'm3' },
    { from: 'ql1', to: 't6' },
    { from: 'qv6', to: 'acc' },
    { from: 'm3', to: 's3' },
    { from: 't6', to: 's3' },
    ...['s1', 's4', 's6', 's7', 's8', 'e5', 'a1'].map((to) => ({ from: 's3', to })),
    { from: 'a1', to: 'gw' },
  ],
};
