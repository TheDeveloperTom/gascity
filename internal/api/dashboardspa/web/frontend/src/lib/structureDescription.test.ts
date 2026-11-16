import { describe, expect, it } from 'vitest';
import { structureDescription } from './structureDescription';

// Real text of dw-1baxx4 (live rig, read 16.11): 719 chars, no newline.
const DW_1BAXX4 =
  'Приказ владельца 12.11 ~16:30Z: начать сразу и довести до конца. Основание: разборы рецензента PR #1 6829411501 и замер оператора 6829452969; замер .gc/agents/mayor/notes/tests-cost-measure.md. Четыре маленьких вливания в main: 1) проверки типов, границ и schema-drift — один раз за прогон; 2) SQL-шарды по измеренному времени; 3) тяжёлые одноразовые проверки на PR по изменению кода, с картой зависимостей и unknown→run; 4) ежедневный и ручной полный прогон, отчёт приёмки. Ничего не удаляем, обязательные проверки не ослабляем, пропуск не PASS. Не входит: удаление тестов, повторное использование результата PR на main, неизолированный vitest, пересборка стенда миграций (отдельный список владельцу после результата).';

describe('structureDescription', () => {
  it('structures the real dw-1baxx4 text: labels, numbered list, paragraphs', () => {
    expect(structureDescription(DW_1BAXX4)).toBe(
      [
        'Приказ владельца 12.11 ~16:30Z: начать сразу и довести до конца.',
        '**Основание:** разборы рецензента PR #1 6829411501 и замер оператора 6829452969; замер .gc/agents/mayor/notes/tests-cost-measure.md.',
        'Четыре маленьких вливания в main:',
        [
          '1. проверки типов, границ и schema-drift — один раз за прогон',
          '2. SQL-шарды по измеренному времени',
          '3. тяжёлые одноразовые проверки на PR по изменению кода, с картой зависимостей и unknown→run',
          '4. ежедневный и ручной полный прогон, отчёт приёмки.',
        ].join('\n'),
        'Ничего не удаляем, обязательные проверки не ослабляем, пропуск не PASS.',
        '**Не входит:** удаление тестов, повторное использование результата PR на main, неизолированный vitest, пересборка стенда миграций (отдельный список владельцу после результата).',
      ].join('\n\n'),
    );
  });

  it('leaves text that already has line breaks unchanged (dp-0sh shape)', () => {
    const multi = '**Что случилось:** a. B. C.\n\n**Совет:** 1) x; 2) y.\nDECISION: z';
    expect(structureDescription(multi)).toBe(multi);
  });

  it('leaves short plain text unchanged', () => {
    expect(structureDescription('Fix the 1.2.3 build. Done.')).toBe('Fix the 1.2.3 build. Done.');
    expect(structureDescription('')).toBe('');
  });

  it('accepts «1.» and «(1)» enumerations', () => {
    expect(structureDescription('Steps: 1. one; 2. two; 3. three')).toBe(
      'Steps:\n\n1. one\n2. two\n3. three',
    );
    expect(structureDescription('Steps: (1) one, (2) two')).toBe('Steps:\n\n1. one\n2. two');
  });

  it('a lone «1)» is not a list; dates and versions are not markers', () => {
    expect(structureDescription('See item 1) only. Then on 12.11 ship v1.2.')).toBe(
      'See item 1) only. Then on 12.11 ship v1.2.',
    );
  });

  it('bolds QUESTION / DECISION labels and starts a paragraph', () => {
    expect(structureDescription('Context here. QUESTION: which one? DECISION: the first.')).toBe(
      'Context here.\n\n**QUESTION:** which one?\n\n**DECISION:** the first.',
    );
  });

  it('splits long text every 2–3 sentences, never inside parentheses or paths', () => {
    const s = (n: number) => `Sentence number ${n} carries enough words to look like real prose here.`;
    const text = [s(1), s(2), s(3), 'Look (Inside. Parens here) ok.', s(5), 'Path ./a/b.md. Final one.'].join(' ');
    const out = structureDescription(text);
    const paras = out.split('\n\n');
    expect(paras.length).toBeGreaterThan(1);
    for (const p of paras) expect(p.match(/[.!?](\s|$)/g)?.length ?? 0).toBeLessThanOrEqual(4);
    expect(out).toContain('Look (Inside. Parens here) ok.');
    expect(out).toContain('./a/b.md.');
    expect(out.replace(/\n\n/g, ' ')).toBe(text);
  });
});
