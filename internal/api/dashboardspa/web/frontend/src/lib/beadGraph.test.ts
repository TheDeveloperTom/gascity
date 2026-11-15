import { describe, expect, it } from 'vitest';
import type { BeadStatus } from 'gas-city-dashboard-shared';
import type { SupervisorBead } from '../supervisor/beadReads';
import { buildBeadGraph } from './beadGraph';

// Minimal bead factory — only the fields beadGraph reads. Everything else
// is filled with inert defaults so the wire shape stays satisfied.
function bead(id: string, status: BeadStatus, extra: Partial<SupervisorBead> = {}): SupervisorBead {
  return {
    id,
    title: `bead ${id}`,
    status,
    issue_type: 'task',
    created_at: '2026-05-01T00:00:00Z',
    ...extra,
  };
}

describe('buildBeadGraph — forward / inverse edges', () => {
  it('builds forward edges from the needs[] field', () => {
    const graph = buildBeadGraph([bead('A', 'open'), bead('B', 'open', { needs: ['A'] })]);
    const b = graph.nodes.get('B');
    expect(b?.deps.map((d) => d.id)).toEqual(['A']);
    expect(b?.deps[0]?.bead?.id).toBe('A');
    expect(b?.deps[0]?.kind).toBe('needs');
  });

  it('builds forward edges from dependencies[].depends_on_id with the dep type as kind', () => {
    const graph = buildBeadGraph([
      bead('A', 'closed'),
      bead('B', 'open', {
        dependencies: [{ depends_on_id: 'A', issue_id: 'B', type: 'blocks' }],
      }),
    ]);
    const b = graph.nodes.get('B');
    expect(b?.deps.map((d) => d.id)).toEqual(['A']);
    expect(b?.deps[0]?.kind).toBe('blocks');
  });

  it('dedups an id that appears in both needs[] and dependencies[]', () => {
    const graph = buildBeadGraph([
      bead('A', 'closed'),
      bead('B', 'open', {
        needs: ['A'],
        dependencies: [{ depends_on_id: 'A', issue_id: 'B', type: 'blocks' }],
      }),
    ]);
    expect(graph.nodes.get('B')?.deps).toHaveLength(1);
  });

  it('computes the inverse blocks[] edge (in-set only)', () => {
    const graph = buildBeadGraph([bead('A', 'open'), bead('B', 'open', { needs: ['A'] })]);
    expect(graph.nodes.get('A')?.blocks.map((x) => x.bead.id)).toEqual(['B']);
  });

  it('preserves the forward edge kind on the inverse blocks[] edge (gascity#4365)', () => {
    // A tracks B (a non-blocking relation): forward edge on A has kind
    // 'tracks'. The inverse edge on B must carry that same kind, not
    // collapse to an untyped blocker — a reciprocal blocks+tracks fixture,
    // matching what #4365 flagged as missing coverage.
    const graph = buildBeadGraph([
      bead('B', 'open'),
      bead('A', 'open', {
        dependencies: [{ depends_on_id: 'B', issue_id: 'A', type: 'tracks' }],
      }),
    ]);
    const b = graph.nodes.get('B');
    expect(b?.blocks).toHaveLength(1);
    expect(b?.blocks[0]?.bead.id).toBe('A');
    expect(b?.blocks[0]?.kind).toBe('tracks');
  });

  it('marks a dependency that points outside the fetched set as unresolved', () => {
    const graph = buildBeadGraph([bead('B', 'open', { needs: ['GHOST'] })]);
    const b = graph.nodes.get('B');
    expect(b?.deps[0]?.bead).toBeNull();
    expect(b?.hasUnresolvedDeps).toBe(true);
  });
});

// The status columns (ready/open/in progress/blocked/done) were superseded by
// the stage board (lib/stageBoard.ts, 2026-11-15) and removed in review M6.
// Readiness stays: it feeds the stage board's `ready` mark.
describe('buildBeadGraph — readiness', () => {
  it('calls an open bead with no needs ready', () => {
    expect(buildBeadGraph([bead('A', 'open')]).nodes.get('A')?.ready).toBe(true);
  });

  it('calls an open bead whose needs are all closed ready', () => {
    const graph = buildBeadGraph([bead('A', 'closed'), bead('B', 'open', { needs: ['A'] })]);
    expect(graph.nodes.get('B')?.ready).toBe(true);
  });

  it('does not call an open bead with an unmet need ready', () => {
    const graph = buildBeadGraph([bead('A', 'open'), bead('B', 'open', { needs: ['A'] })]);
    expect(graph.nodes.get('B')?.ready).toBe(false);
  });

  it('does not call a bead ready when a need is unresolved (honest, not optimistic)', () => {
    const graph = buildBeadGraph([bead('B', 'open', { needs: ['GHOST'] })]);
    expect(graph.nodes.get('B')?.ready).toBe(false);
  });

  it('never calls a non-open bead ready', () => {
    for (const status of ['in_progress', 'blocked', 'closed'] as const) {
      expect(buildBeadGraph([bead('A', status)]).nodes.get('A')?.ready).toBe(false);
    }
  });
});
