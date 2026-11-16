import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectMissing, resetMissing, setLocale } from '../../i18n';
import type { DashboardBead, BeadStatus } from 'gas-city-dashboard-shared';
import { buildBeadGraph } from '../../lib/beadGraph';
import { BeadDependencies } from './BeadDependencies';

// gascity-dashboard-14s1: the needs/blocks dependency view moved off the
// cramped board row into the detail modal. These pin the navigation and
// unresolved-edge behaviour that previously lived in BeadBoard.test.

afterEach(() => cleanup());

function bead(id: string, status: BeadStatus, extra: Partial<DashboardBead> = {}): DashboardBead {
  return {
    id,
    title: `bead ${id}`,
    status,
    issue_type: 'task',
    priority: null,
    created_at: '2026-05-01T00:00:00Z',
    ...extra,
  };
}

function nodeFor(id: string, beads: DashboardBead[]) {
  // buildBeadGraph consumes SupervisorBead (priority: number), while these
  // fixtures model DashboardBead (priority: number | null). Normalize the
  // non-priority rows to 0 so the graph input matches the supervisor shape.
  const graph = buildBeadGraph(beads.map((b) => ({ ...b, priority: b.priority ?? 0 })));
  const node = graph.nodes.get(id);
  if (!node) throw new Error(`no node for ${id}`);
  return node;
}

describe('BeadDependencies', () => {
  it('renders an upstream need and re-centres on click', () => {
    const onOpenBead = vi.fn();
    // B needs A; both inside the window, so A resolves to a navigable row.
    const node = nodeFor('B', [bead('A', 'closed'), bead('B', 'open', { needs: ['A'] })]);
    render(<BeadDependencies node={node} onOpenBead={onOpenBead} />);
    fireEvent.click(screen.getByTitle('Open A'));
    expect(onOpenBead).toHaveBeenCalledWith('A');
  });

  it('renders a downstream blocker (B blocks the beads that need it)', () => {
    const onOpenBead = vi.fn();
    const node = nodeFor('A', [bead('A', 'closed'), bead('B', 'open', { needs: ['A'] })]);
    render(<BeadDependencies node={node} onOpenBead={onOpenBead} />);
    // A's downstream "blocks" set contains B.
    fireEvent.click(screen.getByTitle('Open B'));
    expect(onOpenBead).toHaveBeenCalledWith('B');
  });

  it('labels a typed downstream edge instead of collapsing it to plain "Blocks" (gascity#4365)', () => {
    // A tracks B (non-blocking relation); B's inverse edge must show the
    // 'tracks' label, not present a plain untyped blocker.
    const node = nodeFor('B', [
      bead('B', 'open'),
      bead('A', 'open', { dependencies: [{ depends_on_id: 'B', issue_id: 'A', type: 'tracks' }] }),
    ]);
    render(<BeadDependencies node={node} onOpenBead={vi.fn()} />);
    expect(screen.getByText('tracks')).toBeTruthy();
  });

  it('marks an unresolved upstream edge with no navigation target', () => {
    const node = nodeFor('B', [bead('B', 'open', { needs: ['GHOST'] })]);
    render(<BeadDependencies node={node} onOpenBead={vi.fn()} />);
    expect(screen.queryByTitle('Open GHOST')).toBeNull();
    expect(screen.getByText('unresolved')).toBeTruthy();
  });

  it('states plainly when there are no dependencies', () => {
    const node = nodeFor('A', [bead('A', 'open')]);
    render(<BeadDependencies node={node} />);
    expect(screen.getByText(/no dependencies/i)).toBeTruthy();
  });
});

// H1 16.11: the drawer's «Подробности» showed «Dependencies», «Blocks» and
// «blocks dw-iy9a · …» in English on the Russian UI.
describe('BeadDependencies in Russian', () => {
  beforeEach(() => setLocale('ru'));
  afterEach(() => setLocale('en'));

  it('speaks Russian: headings, edge kinds and the unresolved mark', () => {
    resetMissing();
    const node = nodeFor('B', [
      bead('A', 'open'),
      bead('B', 'open', {
        dependencies: [
          { issue_id: 'B', depends_on_id: 'A', type: 'blocks' },
          { issue_id: 'B', depends_on_id: 'Z', type: 'blocks' },
        ],
      } as Partial<DashboardBead>),
      bead('C', 'open', { needs: ['B'] }),
    ]);
    render(<BeadDependencies node={node} onOpenBead={vi.fn()} />);
    expect(screen.getByText('Зависимости')).toBeTruthy();
    expect(screen.getByText(/^Ждёт/)).toBeTruthy();
    expect(screen.getByText(/^Блокирует/)).toBeTruthy();
    expect(screen.getAllByText('блокирует').length).toBeGreaterThan(0);
    expect(screen.getByText('вне загруженного окна')).toBeTruthy();
    expect(collectMissing()).toEqual([]);
  });
});

describe('BeadDependencies on a phone', () => {
  // H1 16.11: a dependency row was 41 px tall at 390 px (tap targets ≥ 44 px).
  it('each dependency row is a 44 px tap target', () => {
    const node = nodeFor('B', [bead('A', 'closed'), bead('B', 'open', { needs: ['A'] })]);
    render(<BeadDependencies node={node} onOpenBead={vi.fn()} />);
    const row = screen.getByRole('button', { name: /A/ });
    expect(row.className.split(/\s+/)).toContain('min-h-11');
  });
});
