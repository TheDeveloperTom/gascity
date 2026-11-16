import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOCALE_STORAGE_KEY,
  collectMissing,
  getLocale,
  resetMissing,
  readInitialLocale,
  resolveInitialLocale,
  setLocale,
  t,
  tn,
} from './index';
import { RU } from './ru';

const originalLocalStorage = window.localStorage;

function installStorage(storage: Storage): void {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
}

describe('i18n', () => {
  beforeEach(() => {
    resetMissing();
  });

  afterEach(() => {
    installStorage(originalLocalStorage);
    setLocale('en');
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('falls back to English', () => {
    setLocale('ru');
    expect(t('Unknown key')).toBe('Unknown key');
    expect(collectMissing()).toContain('Unknown key');
  });

  it('does not record missing keys in English', () => {
    setLocale('en');
    t('Unknown key');
    expect(collectMissing()).toEqual([]);
  });

  it('translates a known key in Russian', () => {
    setLocale('ru');
    expect(t('Home')).toBe('Главная');
    expect(collectMissing()).toEqual([]);
  });

  it('substitutes vars', () => {
    setLocale('en');
    expect(t('{title} stalled', { title: 'X' })).toBe('X stalled');
  });

  it('russian plurals', () => {
    expect(RU['{n} things wait for you']).toEqual({
      one: 'Вас ждёт {n} дело',
      few: 'Вас ждут {n} дела',
      many: 'Вас ждут {n} дел',
    });
    setLocale('ru');
    const forms = { one: '{n} thing waits for you', other: '{n} things wait for you' };
    expect(tn(1, forms)).toBe('Вас ждёт 1 дело');
    expect(tn(21, forms)).toBe('Вас ждёт 21 дело');
    expect(tn(2, forms)).toBe('Вас ждут 2 дела');
    expect(tn(22, forms)).toBe('Вас ждут 22 дела');
    expect(tn(5, forms)).toBe('Вас ждут 5 дел');
    expect(tn(11, forms)).toBe('Вас ждут 11 дел');
    expect(tn(25, forms)).toBe('Вас ждут 25 дел');
  });

  it('english plurals', () => {
    setLocale('en');
    const forms = { one: '{n} thing waits for you', other: '{n} things wait for you' };
    expect(tn(1, forms)).toBe('1 thing waits for you');
    expect(tn(2, forms)).toBe('2 things wait for you');
    expect(tn(0, forms)).toBe('0 things wait for you');
  });

  it('records a missing plural in Russian and falls back to English', () => {
    setLocale('ru');
    expect(tn(3, { one: '{n} apple', other: '{n} apples' })).toBe('3 apples');
    expect(collectMissing()).toContain('{n} apples');
  });

  it('initial locale', () => {
    expect(resolveInitialLocale('ru', 'en-US')).toBe('ru');
    expect(resolveInitialLocale(null, 'ru-RU')).toBe('ru');
    expect(resolveInitialLocale('xx', 'ru')).toBe('ru');
    expect(resolveInitialLocale(null, undefined)).toBe('ru');
  });

  it('no stored choice means ru, even with navigator en-US', () => {
    expect(resolveInitialLocale(null, 'en-US')).toBe('ru');
    expect(resolveInitialLocale('xx', 'en-GB')).toBe('ru');
  });

  it('stored en stays en', () => {
    expect(resolveInitialLocale('en', 'ru-RU')).toBe('en');
    expect(resolveInitialLocale('en', 'en-US')).toBe('en');
  });

  it('no lane dictionary overrides a core key or another lane', async () => {
    const { RU_HOME } = await import('./ru.home');
    const { RU_BOARD } = await import('./ru.board');
    const { RU_DEBUG } = await import('./ru.debug');
    const seen = new Map<string, string>(Object.keys(RU).map((key) => [key, 'ru']));
    const collisions: string[] = [];
    for (const [name, dict] of [
      ['ru.home', RU_HOME],
      ['ru.board', RU_BOARD],
      ['ru.debug', RU_DEBUG],
    ] as const) {
      for (const key of Object.keys(dict)) {
        const owner = seen.get(key);
        if (owner !== undefined) collisions.push(`${name}:${key} (already in ${owner})`);
        seen.set(key, name);
      }
    }
    expect(collisions).toEqual([]);
  });

  it('the lane dictionaries are merged into the Russian lookup', async () => {
    const { RU_HOME } = await import('./ru.home');
    const { RU_BOARD } = await import('./ru.board');
    const { RU_DEBUG } = await import('./ru.debug');
    setLocale('ru');
    for (const dict of [RU_HOME, RU_BOARD, RU_DEBUG]) {
      for (const [en, ru] of Object.entries(dict)) {
        if (typeof ru === 'string') expect(t(en)).toBe(ru);
      }
    }
    expect(collectMissing()).toEqual([]);
  });

  it('persists the choice and sets the document language', () => {
    setLocale('ru');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ru');
    expect(document.documentElement.lang).toBe('ru');
  });

  it('storage failure falls back', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('storage blocked');
      },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    } satisfies Storage;
    installStorage(throwing);
    expect(() => setLocale('ru')).not.toThrow();
    expect(getLocale()).toBe('ru');
  });

  // polish2 16.11 (owner): a raw key such as `status.open` must never reach the screen.
  it('a dotted key without a translation shows a readable label, never the raw key', () => {
    setLocale('en');
    expect(t('status.open')).toBe('Open');
    expect(t('status.in_progress')).toBe('In progress');
    setLocale('ru');
    expect(t('status.open')).toBe('Ждёт');
    expect(t('kind.never_seen_kind')).toBe('Never seen kind');
  });

  // polish2 16.11 (owner, Brave at 2000 px rendered in English with the toggle
  // on «RU»): an `en` left under the old storage key is not his choice today.
  // Russian by default; only a choice made with the toggle under the current
  // key switches to English.
  it('a stale stored `en` under the pre-polish2 key is ignored', () => {
    window.localStorage.setItem('gascity:locale', 'en');
    expect(LOCALE_STORAGE_KEY).not.toBe('gascity:locale');
    expect(readInitialLocale()).toBe('ru');
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    expect(readInitialLocale()).toBe('en');
  });

  it('the polish2 dictionary never overrides a key of another dictionary', async () => {
    const others = await Promise.all([
      import('./ru').then((m) => m.RU),
      import('./ru.home').then((m) => m.RU_HOME),
      import('./ru.board').then((m) => m.RU_BOARD),
      import('./ru.debug').then((m) => m.RU_DEBUG),
      import('./ru.vk2').then((m) => m.RU_VK2),
      import('./ru.vk4').then((m) => m.RU_VK4),
      import('./ru.vk5').then((m) => m.RU_VK5),
      import('./ru.vk6').then((m) => m.RU_VK6),
      import('./ru.vkfinal').then((m) => m.RU_VKFINAL),
      import('./ru.h1').then((m) => m.RU_H1),
    ]);
    const { RU_POLISH2 } = await import('./ru.polish2');
    const taken = new Set(others.flatMap((d) => Object.keys(d)));
    expect(Object.keys(RU_POLISH2).filter((k) => taken.has(k))).toEqual([]);
  });
});
