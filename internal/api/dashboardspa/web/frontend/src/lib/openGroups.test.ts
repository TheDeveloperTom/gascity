import { afterEach, describe, expect, it, vi } from 'vitest';
import { OPEN_GROUPS_STORAGE_KEY, readOpenGroups, writeOpenGroups } from './openGroups';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('open groups storage', () => {
  it('round trip', () => {
    writeOpenGroups(new Set(['milestone:M04', 'none']));
    expect(window.localStorage.getItem(OPEN_GROUPS_STORAGE_KEY)).toBe('["milestone:M04","none"]');
    expect([...readOpenGroups()]).toEqual(['milestone:M04', 'none']);
  });

  it('garbage JSON is an empty set', () => {
    window.localStorage.setItem(OPEN_GROUPS_STORAGE_KEY, '{not json');
    expect(readOpenGroups().size).toBe(0);
    window.localStorage.setItem(OPEN_GROUPS_STORAGE_KEY, '{"a":1}');
    expect(readOpenGroups().size).toBe(0);
  });

  it('storage that throws is an empty set and never throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readOpenGroups().size).toBe(0);
    expect(() => writeOpenGroups(new Set(['x']))).not.toThrow();
  });
});
