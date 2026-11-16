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
