import { describe, expect, it } from 'vitest';
import type { SupervisorBead } from '../supervisor/beadReads';
import { pauseOf, pauseSummary, pauseTooltip } from './pause';

const bead = (labels: string[], reason?: string): SupervisorBead => ({
  id: 'dw-1',
  title: 't',
  status: 'in_progress',
  issue_type: 'task',
  created_at: '2026-11-15T08:00:00Z',
  labels,
  ...(reason === undefined ? {} : { metadata: { 'devwork.pause_reason': reason } }),
});

describe('pauseOf (a card the Mayor paused)', () => {
  it('reads who, when and the human reason from devwork.pause_reason', () => {
    const p = pauseOf(bead(['hold:mayor'], 'mayor, 2026-11-16T08:12:00Z: ждём решения по схеме БД'));
    expect(p).toEqual({
      hold: 'mayor',
      who: 'mayor',
      when: '16.11 08:12 UTC',
      reason: 'ждём решения по схеме БД',
    });
  });

  it('hold:external is a pause too', () => {
    expect(pauseOf(bead(['hold:external'], 'mayor, 2026-11-16T08:12:00Z: ждём ключ от Stripe'))?.hold).toBe('external');
  });

  it('keeps an unparsed reason whole, and a label with no reason is still a pause', () => {
    expect(pauseOf(bead(['hold:mayor'], 'просто так'))).toEqual({ hold: 'mayor', who: null, when: null, reason: 'просто так' });
    expect(pauseOf(bead(['hold:mayor']))).toEqual({ hold: 'mayor', who: null, when: null, reason: null });
  });

  it('a non-ISO time stays as written', () => {
    expect(pauseOf(bead(['hold:mayor'], 'artem, вчера: стоп'))).toMatchObject({ who: 'artem', when: 'вчера', reason: 'стоп' });
  });

  it('hold:plan, hold:cleared and no hold label are not a pause', () => {
    expect(pauseOf(bead(['hold:plan']))).toBeNull();
    expect(pauseOf(bead(['hold:cleared'], 'mayor, 2026-11-16T08:12:00Z: x'))).toBeNull();
    expect(pauseOf(bead(['milestone:M04']))).toBeNull();
  });

  it('summary and tooltip name the reason, who and when', () => {
    const p = pauseOf(bead(['hold:mayor'], 'mayor, 2026-11-16T08:12:00Z: ждём решения'));
    expect(p).not.toBeNull();
    if (p === null) return;
    expect(pauseSummary(p)).toBe('ждём решения (mayor, 16.11 08:12 UTC)');
    expect(pauseTooltip(p)).toContain('ждём решения');
    expect(pauseTooltip(p)).toContain('mayor');
    expect(pauseTooltip(p)).toContain('16.11 08:12 UTC');
    const bare = pauseOf(bead(['hold:mayor']));
    expect(bare === null ? '' : pauseSummary(bare)).toBe('hold:mayor');
  });
});
