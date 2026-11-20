import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isEmbedded } from './mode';
import contract from './gateway-contract.json';

// Discord mode: the Activity gateway keeps only an exact list of bead
// metadata keys (DESIGN-discord-activity-return §4.3, «M», R-N4) plus every
// `decision.*` key, and drops the rest. Every key the SPA reads must be on
// it, or the board in Discord silently loses that decoration. This scan finds
// every key-shaped string literal in the shipped sources; a new read in a
// later engine pin fails here, not in production.
//
// The list is the shared gateway <-> page contract (city PR #103,
// assets/activity-gw/test/contract.json, copied verbatim to
// ./gateway-contract.json): `metadata_keys` + `metadata_prefixes`.
// `metadata_dropped` names keys the gateway removes on purpose; the page must
// not need them in Discord mode (attachments are stubbed there).
const KEPT = new Set(contract.metadata_keys);
const DROPPED: Record<string, string> = contract.metadata_dropped;
// Key-shaped literals that are not bead metadata the board reads in Discord.
const NOT_BOARD_METADATA: Record<string, string> = {
  'gc.board-chat.turns.v1': 'the card chat (hooks/useCardChat.ts), not shown in Discord',
  'gc.store.maintenance.failed': 'an event type (supervisor/eventSignals.ts), not bead metadata',
};

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'test') continue;
      out.push(...walk(p));
    } else if (
      /\.(ts|tsx)$/.test(name) &&
      !/\.test\.(ts|tsx)$/.test(name) &&
      !/[Ff]ixture/.test(name)
    ) {
      out.push(p);
    }
  }
  return out;
}

const KEY_RE =
  /['"`]((?:gc|devwork|dashboard|decision|owner)\.[A-Za-z0-9_.-]+|rejection_reason)['"`]/g;

describe('bead metadata keys the board reads are on the gateway list', () => {
  const found = new Map<string, string>();
  for (const file of walk(srcDir)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(KEY_RE)) {
      const key = m[1]!;
      if (!found.has(key)) found.set(key, relative(srcDir, file));
    }
  }
  const prefixed = (k: string) => contract.metadata_prefixes.some((p) => k.startsWith(p));

  it('finds the keys (the scan works)', () => {
    expect(found.has('dashboard.stage')).toBe(true);
    expect(found.has('gc.kind')).toBe(true);
  });

  it('every key is kept by the gateway, dropped on purpose, or not bead metadata', () => {
    const missing = [...found]
      .filter(
        ([k]) => !prefixed(k) && !KEPT.has(k) && !(k in DROPPED) && !(k in NOT_BOARD_METADATA),
      )
      .map(([k, f]) => `${k} (${f})`);
    expect(missing).toEqual([]);
  });

  it('attachments: the gateway drops devwork.attachments, and Discord mode never renders them', () => {
    expect(DROPPED['devwork.attachments']).toBeTruthy();
    const desc = readFileSync(join(srcDir, 'vk/panel/CardDescription.tsx'), 'utf8');
    expect(desc).toMatch(/isEmbedded\(\) \? \[\]/);
    expect(isEmbedded()).toBe(false);
  });
});
