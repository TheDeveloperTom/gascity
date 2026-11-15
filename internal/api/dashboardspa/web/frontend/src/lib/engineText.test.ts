import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import { explainEngineText } from './engineText';

beforeEach(() => setLocale('ru'));
afterEach(() => setLocale('en'));

// Engine strings are fixed, machine-generated templates (ruling V7). Each row
// is one template; the raw text always travels beside the sentence so the
// owner can open «подробнее».

const ROWS: readonly [string, string][] = [
  [
    'order timeout of 1m30s exceeded: context deadline exceeded',
    'Плановое поручение не уложилось в 1 мин 30 с',
  ],
  [
    'exit status 1: gc bd: answering from the rig "devwork" store … devwork-rig: devwork: timeout after 115s',
    'База задач devwork не ответила за 115 с',
  ],
  ['Gate: gh:pr', 'ждёт вливания PR'],
  ['Repair PR #578: merge_conflict', 'Починить PR #578: конфликт слияния'],
  ['Repair PR #578 on devwork/task/TheDeveloperTom/dw-bb25e274f3e20608', 'Чинит PR #578'],
  ['merged into main at 84c6fbf51e2c22…', 'влито в main'],
  ['stalled 1h — no assignee', 'стоит 1 ч, никто не взял'],
  ['Nobody has taken it for 4 days', 'никто не берёт 4 дн.'],
  ['timed out after 2500ms', 'не ответил за 2,5 с'],
];

describe('explainEngineText', () => {
  for (const [input, expected] of ROWS) {
    it(`explains «${input}»`, () => {
      const got = explainEngineText(input);
      expect(got.text).toBe(expected);
      expect(got.raw).toBe(input);
      expect(got.known).toBe(true);
    });
  }

  it('an unknown template reads as a neutral sentence and keeps the raw text', () => {
    const got = explainEngineText('some new failure');
    expect(got).toEqual({ text: 'Город сообщил об ошибке', raw: 'some new failure', known: false });
  });
});
