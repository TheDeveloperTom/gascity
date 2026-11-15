import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { buildBeadGraph } from '../../lib/beadGraph';
import { buildRouteIndex, buildStageColumns, stopCardsByTask } from '../../lib/stageBoard';
import { assertAtMostOneMark } from '../../test/assertions/oneMarkRule';
import { BeadBoard } from './BeadBoard';

// Stage board (owner ruling 2026-11-15): Waiting → Working → Review → PR →
// Merged. Route steps fold into their task; each card names its current step
// and links to it in the run.

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => cleanup());

function bead(id: string, extra: Partial<SupervisorBead> = {}): SupervisorBead {
  return {
    id,
    title: `bead ${id}`,
    status: 'open',
    issue_type: 'task',
    created_at: '2026-11-15T08:00:00Z',
    ...extra,
  };
}

const root = bead('gcg-10', {
  title: 'devwork-development',
  metadata: { 'gc.kind': 'workflow', 'gc.var.issue': 'dw-pr', 'gc.root_store_ref': 'rig:devwork' },
});
const openPr = bead('gcg-11', {
  title: 'PR в цель задачи и auto-merge',
  status: 'in_progress',
  metadata: { 'gc.root_bead_id': 'gcg-10', 'dashboard.stage': 'pr' },
});
const gate = bead('gcg-12', {
  issue_type: 'gate',
  metadata: {
    'gc.root_bead_id': 'gcg-10',
    'devwork.pr_number': '512',
    'devwork.pr_url': 'https://github.com/o/r/pull/512',
  },
});

function renderStageBoard(tasks: SupervisorBead[], routeBeads: SupervisorBead[] = []) {
  const graph = buildBeadGraph(tasks);
  const columns = buildStageColumns(
    graph.nodes.values(),
    buildRouteIndex(routeBeads),
    stopCardsByTask(tasks),
  );
  return render(
    <MemoryRouter>
      <BeadBoard columns={columns} selectedId={null} onSelect={vi.fn()} />
    </MemoryRouter>,
  );
}

describe('BeadBoard stages', () => {
  it('renders the five stage columns in route order', () => {
    renderStageBoard([bead('dw-a')]);
    const names = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(names).toEqual(['Waiting', 'Working', 'Review', 'PR', 'Merged']);
    for (const name of names) {
      expect(screen.getByRole('heading', { level: 3, name: name ?? '' })).toBeTruthy();
    }
  });

  it('puts a task under its route stage with its step and PR links', () => {
    renderStageBoard(
      [bead('dw-pr', { title: 'Ship it', status: 'in_progress' })],
      [root, openPr, gate],
    );
    const pr = screen.getByRole('region', { name: 'PR' });
    expect(within(pr).getByText('Ship it')).toBeTruthy();
    const step = within(pr).getByTitle('Open step gcg-11 in its run');
    expect(step.textContent).toBe('PR в цель задачи и auto-merge');
    expect(step.getAttribute('href')).toBe(
      '/runs/gcg-10?scope_kind=rig&scope_ref=devwork&node=gcg-11',
    );
    const prLink = within(pr).getByRole('link', { name: 'PR #512' });
    expect(prLink.getAttribute('href')).toBe('https://github.com/o/r/pull/512');
    // The route beads themselves never render as cards.
    expect(screen.queryByTitle('Select gcg-11')).toBeNull();
    expect(screen.queryByTitle('Select gcg-10')).toBeNull();
  });

  it('shows a queued route as Waiting with a link to the run', () => {
    const queued = { ...root, is_blocked: true };
    renderStageBoard(
      [bead('dw-pr', { title: 'Later' })],
      [queued, { ...openPr, status: 'open', is_blocked: true }],
    );
    const waiting = screen.getByRole('region', { name: 'Waiting' });
    const link = within(waiting).getByTitle('Open run gcg-10');
    expect(link.textContent).toBe('Queued');
  });

  it('shows a blocked mark inside the card column', () => {
    renderStageBoard([bead('dw-b', { status: 'blocked', title: 'Held' })]);
    const waiting = screen.getByRole('region', { name: 'Waiting' });
    expect(within(waiting).getByText('blocked')).toBeTruthy();
  });

  it('tints a stopped card and names the stop without red text', () => {
    const stop = bead('dw-stop', {
      metadata: { 'devwork.stopped_card': 'dw-pr', rejection_reason: 'queue stalled' },
    });
    const { container } = renderStageBoard(
      [bead('dw-pr', { title: 'Ship it', status: 'in_progress' }), stop],
      [root, openPr],
    );
    const card = screen.getByTitle('Select dw-pr').closest('li');
    expect(card?.getAttribute('data-route-attention')).toBe('stopped');
    expect(card?.className).toMatch(/bg-accent\/\[0\.07\]/);
    expect(within(card as HTMLElement).getByText('stopped')).toBeTruthy();
    assertAtMostOneMark(container);
  });

  it('keeps the One Mark Rule with several attention cards', () => {
    const { container } = renderStageBoard([
      bead('dw-1', { status: 'in_progress', metadata: { 'devwork.tdd_refusal': 'no RED' } }),
      bead('dw-2', { status: 'in_progress', metadata: { 'devwork.tdd_refusal': 'no RED' } }),
      bead('dw-3', { status: 'blocked' }),
    ]);
    assertAtMostOneMark(container);
  });

  it('shows recent merges by close time with the close reason', () => {
    renderStageBoard([
      bead('dw-old', { status: 'closed', title: 'Old', updated_at: '2026-11-14T08:00:00Z' }),
      bead('dw-new', {
        status: 'closed',
        title: 'New',
        updated_at: '2026-11-15T09:00:00Z',
        close_reason: 'merged into main at abc123 (PR #9)',
      }),
    ]);
    const merged = screen.getByRole('region', { name: 'Merged' });
    const titles = within(merged)
      .getAllByRole('button')
      .map((b) => b.getAttribute('title'));
    expect(titles).toEqual(['Select dw-new', 'Select dw-old']);
    expect(within(merged).getByText('merged into main at abc123 (PR #9)')).toBeTruthy();
  });
});
