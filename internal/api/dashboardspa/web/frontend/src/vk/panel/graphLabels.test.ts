import { describe, expect, it } from 'vitest';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { taskShortLabel } from './drawerFacts';
import { graphChainRows } from './GraphChain';

// Graph integration 16.11 (eyes on live M04): the drawer said «M04 #3» for the
// card the graph calls «M04 #3.3», and its chain rows kept raw prefixes such as
// «M04 Task 5E — …» and «M03 #2 / Task 6: …». The drawer must use the same
// label and title as the cards and the graph.

function bead(id: string, title: string, extra: Partial<SupervisorBead> = {}): SupervisorBead {
  return {
    id,
    title,
    status: 'open',
    issue_type: 'task',
    created_at: '2026-11-15T08:00:00Z',
    labels: ['milestone:M04'],
    ...extra,
  };
}

const S3 = bead('dw-3511d68caffe01f8.3', 'M04 #3 — ответ по старому профилю', {
  needs: ['dw-37352d0f782d1d17', 'dw-eba63b7db1e9a14e.2'],
});
const M3 = bead('dw-37352d0f782d1d17', 'M04 #3 — Сделать invalidation');
const T6 = bead('dw-eba63b7db1e9a14e.2', 'M03 #2 / Task 6: допуск по ящику', { labels: ['milestone:M03'] });
const E5 = bead('dw-43cc', 'M04 Task 5E — временный read adapter', { needs: [S3.id] });

describe('drawer labels match the graph', () => {
  it('taskShortLabel keeps the child sub-number: «M04 #3.3»', () => {
    expect(taskShortLabel(S3)).toBe('M04 #3.3');
    expect(taskShortLabel(M3)).toBe('M04 #3');
  });

  it('chain rows use the card label and the title without its prefix', () => {
    const rows = graphChainRows(S3, [S3, M3, T6, E5]);
    expect(rows.why.map((r) => [r.label, r.title])).toEqual([
      ['M04 #3', 'Сделать invalidation'],
      ['M03 #2', 'Допуск по ящику'],
    ]);
    expect(rows.waits.map((r) => [r.label, r.title])).toEqual([['M04', 'Временный read adapter']]);
  });
});
