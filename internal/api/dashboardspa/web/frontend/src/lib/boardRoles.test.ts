import { describe, expect, it } from 'vitest';
import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';

import { beadRole } from './boardRoles';

function bead(id: string, extra: Partial<Bead> = {}): Bead {
  return {
    id,
    title: id,
    status: 'open',
    issue_type: 'task',
    created_at: '2026-11-15T08:00:00Z',
    ...extra,
  };
}

describe('beadRole', () => {
  it('order tracking is service', () => {
    expect(
      beadRole(
        bead('gcg-o', {
          title: 'order:archyl-drift-stage',
          labels: ['order-run:archyl-drift-stage', 'order-tracking'],
        }),
      ),
    ).toBe('service');
  });

  it('a gate is service', () => {
    expect(beadRole(bead('dw-ssmbcp', { issue_type: 'gate' }))).toBe('service');
  });

  it('a cross-store gate is route', () => {
    expect(
      beadRole(
        bead('gcg-xsg-2212cab1108e', {
          issue_type: 'gate',
          labels: ['gc:cross-store-gate'],
          metadata: { 'gc.root_bead_id': 'gcg-153601' },
        }),
      ),
    ).toBe('route');
  });

  it('an engine label makes service', () => {
    expect(beadRole(bead('dw-s', { labels: ['gc:session'] }))).toBe('service');
  });

  it('convoy, spec, op, message and session types are service', () => {
    for (const type of ['convoy', 'spec', 'op', 'message', 'session']) {
      expect(beadRole(bead(`x-${type}`, { issue_type: type }))).toBe('service');
    }
  });

  it('a task with a stage label is task', () => {
    expect(beadRole(bead('dw-4xn4b', { labels: ['milestone:M04'] }))).toBe('task');
  });

  it('an epic is task', () => {
    expect(beadRole(bead('dw-mqfcx', { issue_type: 'epic' }))).toBe('task');
  });
});
