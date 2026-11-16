import { describe, expect, it } from 'vitest';
import type { ProcessUsage } from 'gas-city-dashboard-shared';
import { groupOf, groupProcesses } from './processGroups';

const p = (name: string, cpu_pct: number, rss_bytes: number, count = 1): ProcessUsage => ({
  name,
  count,
  cpu_pct,
  rss_bytes,
});

describe('groupOf', () => {
  it.each([
    ['claude', 'agents'],
    ['codex', 'agents'],
    ['cursor-agent', 'agents'],
    // Claude Code installs as a version-named binary (~/.local/share/claude/versions/2.1.325).
    ['2.1.325', 'agents'],
    ['Codex (Aperitif', 'agents'],
    ['dolt', 'stores'],
    ['beads', 'stores'],
    ['bd', 'stores'],
    ['gc', 'supervisor'],
    ['tmux', 'supervisor'],
    ['bazel', 'builds'],
    ['java', 'builds'],
    ['go', 'builds'],
    ['compile', 'builds'],
    ['node', 'builds'],
    ['pnpm', 'builds'],
    ['mcp@0.0.41', 'builds'],
    ['Google Chrome He', 'browsers'],
    ['Safari', 'browsers'],
    ['com.apple.WebKi', 'browsers'],
    ['chrome-headless', 'browsers'],
    ['WindowServer', 'other'],
    ['bdx', 'other'],
  ])('%s → %s', (name, group) => {
    expect(groupOf(name)).toBe(group);
  });
});

describe('groupProcesses', () => {
  const items = [
    p('claude', 140, 1_800_000_000, 6),
    p('codex', 20, 300_000_000),
    p('dolt', 5, 280_000_000, 3),
    p('gc', 1, 900_000_000, 4),
    p('WindowServer', 12, 80_000_000),
  ];
  const rest = { count: 200, cpu_pct: 3, rss_bytes: 400_000_000 };

  it('sums CPU as a share of the whole Mac and memory in bytes', () => {
    const groups = groupProcesses(items, rest, 10);
    const agents = groups.find((g) => g.id === 'agents');
    expect(agents?.cpuPctOfMac).toBeCloseTo(16);
    expect(agents?.rssBytes).toBe(2_100_000_000);
    expect(agents?.count).toBe(7);
  });

  it('folds the capped tail into other', () => {
    const other = groupProcesses(items, rest, 10).find((g) => g.id === 'other');
    expect(other?.count).toBe(201);
    expect(other?.rssBytes).toBe(480_000_000);
    expect(other?.cpuPctOfMac).toBeCloseTo(1.5);
  });

  it('lists each group’s names heaviest first, by the chosen measure', () => {
    const agents = groupProcesses(items, rest, 10).find((g) => g.id === 'agents');
    expect(agents?.names.map((n) => n.name)).toEqual(['claude', 'codex']);
  });

  it('always returns every group in a fixed order so colours and rows never jump', () => {
    expect(groupProcesses([], { count: 0, cpu_pct: 0, rss_bytes: 0 }, 10).map((g) => g.id)).toEqual(
      ['agents', 'stores', 'supervisor', 'builds', 'browsers', 'other'],
    );
  });
});
