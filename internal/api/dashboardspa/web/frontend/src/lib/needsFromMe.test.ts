import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  BLOCKER_ID,
  NOW_MS,
  OWNER_ITEMS,
  QUESTION_ID,
  SECOND_QUESTION_ID,
  STALLED_ID,
  UNLINKED_ID,
  needsBoard,
} from '../vk/needs/needsFixture';
import { needsFromBoard, useNeedsFromMeCount } from './needsFromMe';

const read = vi.hoisted(() => ({ current: undefined as unknown, owner: [] as unknown[] }));
vi.mock('../hooks/useBoardData', () => ({ useBoardData: () => read.current }));
vi.mock('../attention/context', () => ({
  useAttentionModel: () => ({ owner: { items: read.owner } }),
}));

const model = () => needsFromBoard(needsBoard(), [], [], NOW_MS, false, OWNER_ITEMS);

describe('needsFromBoard', () => {
  it('lists the Mayor’s questions, then owner asks from mail and agents', () => {
    const m = model();
    expect(m.needs.map((n) => [n.kind, n.id])).toEqual([
      ['question', QUESTION_ID],
      ['question', SECOND_QUESTION_ID],
      ['ask', 'mail:M-1:unread'],
    ]);
    const ask = m.needs[2];
    expect(ask?.title).toBe('Нужен доступ к Supabase');
    expect(ask?.href).toBe('/mail?message=M-1');
  });

  it('drops the attention copy of a question and unreadable items', () => {
    const ids = model().needs.map((n) => n.id);
    expect(ids).not.toContain(`beads:${QUESTION_ID}:mayor-decision`);
    expect(ids).not.toContain('mail:unavailable');
  });

  it('shows stalls under «Стоит»; only those marked for the owner count', () => {
    const m = model();
    expect(m.stalls.map((s) => s.id)).toEqual([UNLINKED_ID, BLOCKER_ID, STALLED_ID]);
    expect(m.stalls.map((s) => s.forOwner)).toEqual([true, false, false]);
    expect(m.count).toBe(4);
  });

  it('counts every task held, directly or not, split by milestone', () => {
    const question = model().needs[0];
    expect(question?.holds).toBe(22);
    expect(question?.breakdown).toEqual([
      { milestone: 'M04', count: 10 },
      { milestone: 'M03', count: 4 },
    ]);
    expect(question?.waitedMs).toBe((3 * 24 + 8) * 3_600_000);
    expect(question?.choices).toEqual(['Сегодня в 18:00', 'Завтра в 10:00']);
  });

  it('keeps owner asks while the board is unread', () => {
    const m = needsFromBoard(undefined, [], [], NOW_MS, true, OWNER_ITEMS);
    expect(m.state).toBe('loading');
    expect(m.needs.map((n) => n.kind)).toEqual(['ask']);
    expect(m.stalls).toEqual([]);
    expect(m.count).toBe(1);
  });
});

describe('useNeedsFromMeCount', () => {
  it('is the count on the page: questions, owner asks, owner-marked stalls', () => {
    read.current = {
      data: needsBoard(),
      rigs: [],
      sessions: [],
      loading: false,
      error: null,
      fetchedAt: undefined,
      refresh: async () => {},
    };
    read.owner = [...OWNER_ITEMS];
    vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    const { result } = renderHook(() => useNeedsFromMeCount());
    expect(result.current).toBe(model().count);
    expect(result.current).toBe(4);
    vi.restoreAllMocks();
  });
});
