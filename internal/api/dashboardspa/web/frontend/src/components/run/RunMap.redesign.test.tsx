import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunLane, RunSummary, SourceState } from 'gas-city-dashboard-shared';
import { RunMap } from './RunMap';

// Redesign (Signal & Pavement, Task 8): blocked runs need the owner, so the
// Blocked section leads the page, ahead of the active lanes. The historical
// section reads "Completed runs" (C11) and keeps its "Historical runs" region.

afterEach(() => cleanup());

// Fixture builders copied from RunMap.test.tsx.
function emptyRunSummary(): RunSummary {
  return {
    totalActive: 0,
    totalHistorical: 0,
    runCounts: {
      total: 0,
      visible: 0,
      prReview: 0,
      designReview: 0,
      bugfix: 0,
      blocked: 0,
      other: 0,
    },
    lanes: [],
    historicalLanes: [],
    blockedLanes: [],
    recentChanges: [],
    census: { status: 'unavailable', error: 'run health has not been derived' },
  };
}

function lane(id: string, overrides: Partial<RunLane> = {}): RunLane {
  return {
    id,
    title: `Run ${id}`,
    formula: { status: 'known', name: 'mol-focus-review' },
    scope: {
      status: 'available',
      kind: 'city',
      ref: 'racoon-city',
      rootStoreRef: 'city:racoon-city',
    },
    external: { status: 'unavailable', error: 'external unavailable in test' },
    phase: 'complete',
    phaseLabel: 'complete',
    statusCounts: { closed: 1 },
    activeAssignees: [],
    updatedAt: { status: 'available', at: '2026-05-24T12:00:00Z' },
    stages: [],
    progress: { status: 'unavailable', error: 'run progress unavailable in test' },
    formulaStageResolved: false,
    health: { status: 'unavailable', error: 'run health has not been derived' },
    ...overrides,
  };
}

function source(summary: Partial<RunSummary>): SourceState<RunSummary> {
  return {
    source: 'runs',
    status: 'fresh',
    fetchedAt: '2026-05-24T12:00:00Z',
    staleAt: '2026-05-24T12:01:00Z',
    error: { kind: 'none' },
    data: { ...emptyRunSummary(), ...summary },
  };
}

function renderMap(summary: Partial<RunSummary>, showHistory = false) {
  return render(
    <MemoryRouter>
      <RunMap
        source={source(summary)}
        now={Date.parse('2026-05-24T12:01:00Z')}
        showHistory={showHistory}
      />
    </MemoryRouter>,
  );
}

describe('RunMap redesign', () => {
  it('blocked first', () => {
    const { container } = renderMap({
      totalActive: 1,
      lanes: [lane('gc-active', { phase: 'review', phaseLabel: 'review round 1' })],
      blockedLanes: [lane('gc-blocked', { phase: 'blocked', phaseLabel: 'blocked' })],
    });
    const blocked = screen.getByRole('region', { name: 'Blocked runs' });
    const active = container.querySelector('#runs-active-list');
    expect(active).not.toBeNull();
    expect(
      blocked.compareDocumentPosition(active as Element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('completed heading', () => {
    renderMap({ totalHistorical: 1, historicalLanes: [lane('gc-done')] }, true);
    const section = screen.getByRole('region', { name: 'Historical runs' });
    expect(within(section).getByRole('heading', { name: 'Completed runs' })).toBeTruthy();
  });
});
