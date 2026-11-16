import type { ProcessRest, ProcessUsage } from 'gas-city-dashboard-shared';

// «Кто ест Мак» (owner 16.11): the per-name process list from
// GET /api/health/live, sorted into the groups the owner thinks in. Names are
// the kernel's short command names (macOS truncates them at 16 bytes), so the
// rules match prefixes, not full app names.

export type ProcessGroupId = 'agents' | 'stores' | 'supervisor' | 'builds' | 'browsers' | 'other';

/** Fixed order: rows and colours never jump between polls. */
export const PROCESS_GROUP_ORDER: readonly ProcessGroupId[] = [
  'agents',
  'stores',
  'supervisor',
  'builds',
  'browsers',
  'other',
];

const RULES: ReadonlyArray<[ProcessGroupId, RegExp]> = [
  // Agent sessions: the coding CLIs the city runs.
  // Claude Code runs as a version-named binary (versions/2.1.325), so a bare
  // semver name is an agent too; the Codex desktop app is «Codex (…».
  [
    'agents',
    /^(claude|codex|cursor-agent|gemini|opencode|qwen|copilot|kimi|amp|aider|\d+\.\d+\.\d+|codex \(.*)$/i,
  ],
  // The bead stores: Dolt servers and the bd client.
  ['stores', /^(dolt|bd|beads)$/i],
  // The city's own machinery: the gc supervisor and the tmux that hosts sessions.
  ['supervisor', /^(gc|gc-[\w.-]+|tmux)$/i],
  // Builds and the tool processes they spawn.
  [
    'builds',
    /^(bazel|bazelisk|java|go|gopls|compile|link|asm|cgo|vet|node|npm|npx|pnpm|yarn|bun|deno|vite|esbuild|tsc|vitest|cargo|rustc|clang|clang\+\+|ld|make|cc1|cc1plus|python3?|uv|mcp.*)$/i,
  ],
  [
    'browsers',
    /^(google chrome|chrome|chromium|safari|firefox|arc|brave|microsoft edge|opera|comet|com\.apple\.webki)/i,
  ],
];

export function groupOf(name: string): ProcessGroupId {
  for (const [group, rule] of RULES) {
    if (rule.test(name)) return group;
  }
  return 'other';
}

export interface ProcessGroup {
  id: ProcessGroupId;
  count: number;
  /** Summed CPU as a share of the whole Mac (all cores), 0–100. */
  cpuPctOfMac: number;
  rssBytes: number;
  /** The names in the group, heaviest first by memory. */
  names: ProcessUsage[];
}

export function groupProcesses(
  items: readonly ProcessUsage[],
  rest: ProcessRest,
  cores: number,
): ProcessGroup[] {
  const perCore = cores > 0 ? cores : 1;
  const groups = new Map<ProcessGroupId, ProcessGroup>(
    PROCESS_GROUP_ORDER.map((id) => [id, { id, count: 0, cpuPctOfMac: 0, rssBytes: 0, names: [] }]),
  );
  for (const item of items) {
    const g = groups.get(groupOf(item.name)) as ProcessGroup;
    g.count += item.count;
    g.cpuPctOfMac += item.cpu_pct / perCore;
    g.rssBytes += item.rss_bytes;
    g.names.push(item);
  }
  const other = groups.get('other') as ProcessGroup;
  other.count += rest.count;
  other.cpuPctOfMac += rest.cpu_pct / perCore;
  other.rssBytes += rest.rss_bytes;
  for (const g of groups.values()) {
    g.names.sort((a, b) => b.rss_bytes - a.rss_bytes || b.cpu_pct - a.cpu_pct);
  }
  return PROCESS_GROUP_ORDER.map((id) => groups.get(id) as ProcessGroup);
}
