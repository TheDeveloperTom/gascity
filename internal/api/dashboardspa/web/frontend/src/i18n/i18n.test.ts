import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOCALE_STORAGE_KEY,
  collectMissing,
  getLocale,
  resetMissing,
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
    expect(resolveInitialLocale(null, 'en-US')).toBe('en');
    expect(resolveInitialLocale('xx', 'ru')).toBe('ru');
    expect(resolveInitialLocale(null, undefined)).toBe('en');
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
});
