import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  BLOCKER_ID,
  NOW_MS,
  QUESTION_ID,
  SECOND_QUESTION_ID,
  STALLED_ID,
  UNLINKED_ID,
  needsBoard,
} from '../vk/needs/needsFixture';
import { needsFromBoard, useNeedsFromMeCount } from './needsFromMe';

const read = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('../hooks/useBoardData', () => ({ useBoardData: () => read.current }));

describe('needsFromBoard', () => {
  it('lists linked questions first, then stalls the Mayor does not know about', () => {
    const model = needsFromBoard(needsBoard(), [], [], NOW_MS);
    expect(model.needs.map((n) => n.id)).toEqual([
      QUESTION_ID,
      SECOND_QUESTION_ID,
      BLOCKER_ID,
      STALLED_ID,
    ]);
    expect(model.needs.map((n) => n.kind)).toEqual(['question', 'question', 'stall', 'stall']);
  });

  it('never lists an unlinked question as the owner’s', () => {
    const model = needsFromBoard(needsBoard(), [], [], NOW_MS);
    expect(model.needs.some((n) => n.id === UNLINKED_ID)).toBe(false);
  });

  it('counts every task held, directly or not, split by milestone', () => {
    const question = needsFromBoard(needsBoard(), [], [], NOW_MS).needs[0];
    expect(question?.holds).toBe(22);
    expect(question?.breakdown).toEqual([
      { milestone: 'M04', count: 10 },
      { milestone: 'M03', count: 4 },
    ]);
    expect(question?.waitedMs).toBe((3 * 24 + 8) * 3_600_000);
    expect(question?.choices).toEqual(['Сегодня в 18:00', 'Завтра в 10:00']);
  });

  it('is empty and not ready while the board is unread', () => {
    const model = needsFromBoard(undefined, [], [], NOW_MS);
    expect(model.state).toBe('loading');
    expect(model.needs).toEqual([]);
  });
});

describe('useNeedsFromMeCount', () => {
  it('is the number of needs on the page', () => {
    read.current = {
      data: needsBoard(),
      rigs: [],
      sessions: [],
      loading: false,
      error: null,
      fetchedAt: undefined,
      refresh: async () => {},
    };
    vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    const { result } = renderHook(() => useNeedsFromMeCount());
    expect(result.current).toBe(needsFromBoard(needsBoard(), [], [], NOW_MS).needs.length);
    expect(result.current).toBe(4);
    vi.restoreAllMocks();
  });
});
