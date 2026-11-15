import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import { formatWhen } from './whenText';

const NOW = Date.parse('2026-11-15T10:40:00Z');
const ZONE = 'Europe/Berlin';

afterEach(() => setLocale('en'));

describe('formatWhen', () => {
  it('today', () => {
    expect(formatWhen('2026-11-15T10:32:31Z', NOW, ZONE)).toBe('today at 11:32');
    setLocale('ru');
    expect(formatWhen('2026-11-15T10:32:31Z', NOW, ZONE)).toBe('сегодня в 11:32');
  });

  it('just after midnight in the zone is today', () => {
    expect(formatWhen('2026-11-14T23:10:00Z', NOW, ZONE)).toBe('today at 00:10');
  });

  it('yesterday', () => {
    setLocale('ru');
    expect(formatWhen('2026-11-14T22:33:00Z', NOW, ZONE)).toBe('вчера в 23:33');
  });

  it('older days use the date', () => {
    setLocale('ru');
    const expected = new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'short',
      timeZone: ZONE,
    }).format(new Date('2026-11-12T18:00:00Z'));
    expect(formatWhen('2026-11-12T18:00:00Z', NOW, ZONE)).toBe(expected);
  });
});
