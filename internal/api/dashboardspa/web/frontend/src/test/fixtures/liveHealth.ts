import type { LiveHealth } from 'gas-city-dashboard-shared';

// A calm Mac: 10 cores at load 3.8, 19 of 24 GiB used, 40 GiB free on disk.
export function liveFixture(over: Partial<LiveHealth> = {}): LiveHealth {
  return {
    sampled_at: '2026-11-16T10:00:00Z',
    cpu: {
      cores: 10,
      busy_pct: { status: 'available', value: 31 },
      load: { status: 'available', value: { load_avg_1: 3.8, load_avg_5: 3.7, load_avg_15: 3.1 } },
    },
    memory: {
      status: 'available',
      value: {
        total_bytes: 24 * 2 ** 30,
        used_bytes: 19 * 2 ** 30,
        available_bytes: 5 * 2 ** 30,
        swap_total_bytes: 4 * 2 ** 30,
        swap_used_bytes: 2 * 2 ** 30,
        pressure: 'normal',
      },
    },
    disk: { status: 'available', value: { total_bytes: 460 * 2 ** 30, free_bytes: 40 * 2 ** 30 } },
    processes: {
      status: 'available',
      coverage: 'all_processes',
      total: 3,
      items: [],
      rest: { count: 0, cpu_pct: 0, rss_bytes: 0 },
    },
    ...over,
  };
}
