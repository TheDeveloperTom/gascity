import { describe, expect, it } from 'vitest';
import type { StatusBody } from 'gas-city-dashboard-shared/gc-supervisor';
import { composeAttention } from './compose';
import { createAttentionContributors } from './registry';

// Review I-4: the former Home lamps are city problems in the attention model,
// so Home's «Неполадки», the rail's Health pill and Health's city list all
// read one slice and one number.

function status(overrides: Partial<StatusBody> = {}): StatusBody {
  return {
    name: 'c',
    path: '/tmp/c',
    agent_count: 2,
    rig_count: 1,
    running: 2,
    suspended: false,
    uptime_sec: 10,
    agents: { total: 2, running: 2, suspended: 0, quarantined: 0 },
    rigs: { total: 1, suspended: 0 },
    work: { open: 0, ready: 0, in_progress: 0 },
    mail: { total: 0, unread: 0 },
    store_health: {
      live_rows: 1,
      path: '/tmp/s',
      ratio_mb_per_row: 0.1,
      size_bytes: 1,
      threshold_mb_per_row: 1,
      warning: false,
    },
    ...overrides,
  } as StatusBody;
}

function cityIds(facts: Parameters<typeof createAttentionContributors>[0]) {
  const m = composeAttention(createAttentionContributors(facts));
  expect(m.owner.items).toEqual([]);
  return { ids: m.city.items.map((item) => item.id), total: m.city.total };
}

describe('lamp problems in the city slice', () => {
  it('a healthy status and an open feed add nothing', () => {
    expect(cityIds({ health: { cityStatus: status() }, liveFeed: 'open' }).ids).toEqual([]);
    expect(cityIds({ liveFeed: 'connecting' }).ids).toEqual([]);
  });

  it('a disconnected feed is a city problem', () => {
    const { ids, total } = cityIds({ liveFeed: 'closed' });
    expect(ids).toEqual(['activity:live-feed']);
    expect(total).toBe(1);
  });

  it('store maintenance and quarantined agents are city problems', () => {
    const s = status({
      agents: { total: 3, running: 1, suspended: 1, quarantined: 2 },
      store_health: { ...status().store_health!, last_gc_status: 'failed' },
    });
    const { ids, total } = cityIds({ health: { cityStatus: s } });
    expect(ids).toEqual(
      expect.arrayContaining([
        'health:store-maintenance',
        'health:agents-quarantined',
        'health:agents-suspended',
      ]),
    );
    expect(total).toBe(3);
  });

  it('a partial status reports no lamp problem', () => {
    const s = status({
      partial: true,
      store_health: { ...status().store_health!, last_gc_status: 'failed' },
    });
    expect(cityIds({ health: { cityStatus: s } }).ids).toEqual([]);
  });
});
