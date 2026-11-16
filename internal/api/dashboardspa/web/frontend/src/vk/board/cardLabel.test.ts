import { describe, expect, it } from 'vitest';
import { cardLabel, shortEpicName } from './cardLabel';

// Real titles from the live devwork-platform board (16.11) and the label the
// approved canvas (Cards / Main) shows for them.
describe('cardLabel (canvas short label)', () => {
  it.each([
    [
      'M03 #2 / Task 6: допуск, enqueue и claim по собственному ящику пользователя, без mp_assignment',
      'M03',
      'M03 #2',
      'Допуск, enqueue и claim по собственному ящику пользователя, без mp_assignment',
    ],
    [
      'Land M03 #2 / Task 6: допуск, enqueue и claim по собственному ящику пользователя',
      null,
      'M03 #2',
      'Допуск, enqueue и claim по собственному ящику пользователя',
    ],
    [
      'M04 — ответ владельца на ВВ-6 (способ оплаты клиентом) в m04-client-payment-channel.md',
      'M04',
      'M04 ВВ-6',
      'Ответ владельца на ВВ-6 (способ оплаты клиентом) в m04-client-payment-channel.md',
    ],
    [
      'M04 — приёмка этапа (проверяемые пункты §5 L186)',
      'M04',
      'M04 приёмка',
      'Приёмка этапа (проверяемые пункты §5 L186)',
    ],
    [
      'M04 — исполнитель шлюза llm для embeddings (L180; после M04 #1 и ВВ-1)',
      'M04',
      'M04',
      'Исполнитель шлюза llm для embeddings (L180; после M04 #1 и ВВ-1)',
    ],
    [
      'M04 Task 5E — временный read adapter досье для matching (мост M04 → M06)',
      'M04',
      'M04',
      'Временный read adapter досье для matching (мост M04 → M06)',
    ],
    ['M04 / 0b — пакет этапа (ревизия 6, PR #419)', null, 'M04', 'Пакет этапа (ревизия 6, PR #419)'],
    [
      'M02 #7: запускать платную когорту 0a и проверки на объёме prod',
      null,
      'M02 #7',
      'Запускать платную когорту 0a и проверки на объёме prod',
    ],
    [
      'M01: строгий прогон тестов — пропуск не считается зелёным',
      'M01',
      'M01',
      'Строгий прогон тестов — пропуск не считается зелёным',
    ],
    [
      'Доработка по провалу ворот Refinery, раунд 1: M04 #3 — Сделать invalidation при изменении вакансии',
      null,
      'M04 #3',
      'Доработка по провалу ворот Refinery, раунд 1: Сделать invalidation при изменении вакансии',
    ],
    ['стоит: dw-vb7qk (M00 #3) с 18:55 UTC', null, 'M00 #3', 'стоит: dw-vb7qk (M00 #3) с 18:55 UTC'],
    [
      'Мэр: перенарезать остаток M03 под одного пользователя (план)',
      'M03',
      'M03',
      'Мэр: перенарезать остаток M03 под одного пользователя (план)',
    ],
    [
      'Город: журналы базы задач растут без ограничения (около 1,5 ГБ)',
      null,
      'Город',
      'Журналы базы задач растут без ограничения (около 1,5 ГБ)',
    ],
  ])('%s', (title, milestone, label, rest) => {
    expect(cardLabel({ title, milestone })).toEqual({ label, title: rest });
  });

  it('a bead id leading the title is dropped; the epic names the card («Один тип»)', () => {
    expect(
      cardLabel({
        title:
          'dw-mqfcx.5 часть 2: миграция 0425 (удаление столбцов слепых вакансий); production — по слову владельца',
        epicTitle: 'Один тип пользователя',
      }),
    ).toEqual({
      label: 'Один тип',
      title: 'Миграция 0425 (удаление столбцов слепых вакансий); production — по слову владельца',
    });
  });

  it('no derivable label → null, never the bead id', () => {
    const out = cardLabel({ title: 'Repair PR #475: CI красный (unit, web-ui), ветка позади main' });
    expect(out.label).toBeNull();
    expect(out.title).toBe('Repair PR #475: CI красный (unit, web-ui), ветка позади main');
  });

  it('shortEpicName keeps the first two words', () => {
    expect(shortEpicName('Один тип пользователя')).toBe('Один тип');
    expect(shortEpicName('Автотесты продукта быстрее и дешевле, без потери защиты (приказ владельца 12.11)')).toBe(
      'Автотесты продукта',
    );
  });
});

describe('cardLabel sub-numbers (graph integration 16.11)', () => {
  it('keeps «#3.3» from the title', () => {
    expect(cardLabel({ title: 'M04 #3.3 — ответ по старому профилю' })).toEqual({
      label: 'M04 #3.3',
      title: 'Ответ по старому профилю',
    });
  });

  it('takes the sub-number from an id ending .3 when the title says only «#3»', () => {
    expect(
      cardLabel({ title: 'M04 #3 — ответ по старому профилю', id: 'dw-3511d68caffe01f8.3' }).label,
    ).toBe('M04 #3.3');
    expect(
      cardLabel({ title: 'M04 #3 — инвалидация при изменении вакансии', id: 'dw-3511d68caffe01f8.1' }).label,
    ).toBe('M04 #3.1');
  });

  it('a plain id keeps «#3»; a title sub-number wins over the id', () => {
    expect(cardLabel({ title: 'M04 #3 — Сделать invalidation', id: 'dw-37352d0f782d1d17' }).label).toBe('M04 #3');
    expect(cardLabel({ title: 'M04 #3.2 — x', id: 'dw-abc.5' }).label).toBe('M04 #3.2');
  });

  it('an id suffix never touches labels without a number', () => {
    expect(cardLabel({ title: 'M04 — приёмка этапа', id: 'dw-abc.9' }).label).toBe('M04 приёмка');
    expect(cardLabel({ title: 'M04 — разделить страны', id: 'dw-abc.9' }).label).toBe('M04');
  });
});

describe('board card label uses the bead id (integration 16.11)', () => {
  it('KanbanCard labelOf gives «M04 #3.3» for child .3, so card and graph agree', async () => {
    const { labelOf } = await import('./KanbanCard');
    const bead = {
      id: 'dw-3511d68caffe01f8.3',
      title: 'M04 #3 — ответ по старому профилю',
      status: 'open',
      issue_type: 'task',
      created_at: '2026-11-15T08:00:00Z',
    };
    expect(labelOf(bead, () => undefined).label).toBe('M04 #3.3');
  });
});

describe('cardLabel id sub-number skips titles that already name the task', () => {
  it('«M03 #2 / Task 6: …» on id .2 stays «M03 #2»', () => {
    expect(
      cardLabel({ title: 'M03 #2 / Task 6: допуск по ящику', id: 'dw-eba63b7db1e9a14e.2' }).label,
    ).toBe('M03 #2');
  });
});
