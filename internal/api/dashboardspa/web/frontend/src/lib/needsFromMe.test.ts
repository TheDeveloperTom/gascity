import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  BLOCKER_ID,
  NOW_MS,
  OWNER_ITEMS,
  QUESTION_ID,
  SECOND_QUESTION_ID,
  HELD_STALL_ID,
  STALLED_ID,
  UNLINKED_ID,
  needsBoard,
  needsBoardWithHeldStall,
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

  // polish2 16.11 (owner): a stall held behind an owner question is noise in
  // «Стоит»; it folds under that question instead.
  it('a stall held behind an owner question folds under it, out of «Стоит»', () => {
    const m = needsFromBoard(needsBoardWithHeldStall(), [], [], NOW_MS, false, OWNER_ITEMS);
    expect(m.stalls.map((s) => s.id)).not.toContain(HELD_STALL_ID);
    const question = m.needs.find((n) => n.id === QUESTION_ID);
    expect(question?.heldStalls?.map((s) => s.id)).toEqual([HELD_STALL_ID]);
    expect(m.needs.find((n) => n.id === SECOND_QUESTION_ID)?.heldStalls ?? []).toEqual([]);
    // the badge count does not change because of the fold
    expect(m.count).toBe(model().count);
  });

  // review I-2: only a «Никто не взял» blocker folds; an owner-marked stall
  // never starts collapsed, so the badge equals what the page shows.
  it('an owner-marked stall behind a question stays in «Стоит» and the badge equals the visible owner items', () => {
    const board = needsBoardWithHeldStall();
    board.items = board.items.map((b) =>
      b.id === HELD_STALL_ID ? { ...b, labels: ['needs/operator'] } : b,
    );
    const m = needsFromBoard(board, [], [], NOW_MS, false, OWNER_ITEMS);
    expect(m.stalls.map((s) => s.id)).toContain(HELD_STALL_ID);
    expect(m.needs.flatMap((n) => n.heldStalls ?? []).map((s) => s.id)).not.toContain(
      HELD_STALL_ID,
    );
    const visibleOwnerStalls = m.stalls.filter((s) => s.forOwner).length;
    expect(m.count).toBe(m.needs.length + visibleOwnerStalls);
  });

  it('a stalled card at work behind a question is not folded (only «Никто не взял» folds)', () => {
    const board = needsBoardWithHeldStall();
    board.items = board.items.map((b) =>
      b.id === HELD_STALL_ID
        ? {
            ...b,
            status: 'in_progress',
            assignee: 'devwork/polecat-9',
            updated_at: '2026-11-14T20:46:00Z',
          }
        : b,
    );
    const m = needsFromBoard(board, [], [], NOW_MS, false, OWNER_ITEMS);
    expect(m.stalls.map((s) => s.id)).toContain(HELD_STALL_ID);
    expect(m.needs.flatMap((n) => n.heldStalls ?? [])).toEqual([]);
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
