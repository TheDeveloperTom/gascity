import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Discord mode: the Activity gateway keeps only an exact list of bead
// metadata keys (DESIGN-discord-activity-return §4.3, «M», R-N4) plus every
// `decision.*` key, and drops the rest. Every key the SPA reads must be on
// it, or the board in Discord silently loses that decoration. This scan finds
// every key-shaped string literal in the shipped sources; a new read in a
// later engine pin fails here, not in production.
//
// M as the design lists it (the 15.11 METADATA_KEYS):
const DESIGN_M = [
  'gc.cancel_requested',
  'gc.checkpoint',
  'gc.checkpoint_hold',
  'gc.cross_store_blocker',
  'gc.cross_store_gate_owner',
  'gc.drain_control_id',
  'gc.drain_count',
  'gc.drain_member_id',
  'gc.formula_contract',
  'gc.founder_gate',
  'gc.kind',
  'gc.last_heartbeat_at',
  'gc.outcome',
  'gc.root_bead_id',
  'gc.root_store_ref',
  'gc.routed_to',
  'gc.run_id',
  'gc.run_target',
  'gc.scope_kind',
  'gc.scope_ref',
  'gc.session_id',
  'gc.source_anchor_id',
  'gc.source_bead_id',
  'gc.store.maintenance.failed',
  'gc.var.issue',
  'gc.waiting_on',
  'gc.workflow_id',
  'dashboard.stage',
  'dashboard.label',
  'devwork.pr_url',
  'devwork.pr_number',
  'devwork.stopped_card',
  'devwork.tdd_refusal',
  'rejection_reason',
];
// Re-derived against b94466f9 (lane B, 20.11): the SPA reads these too. Lane A
// adds them to the gateway's list; each names the file that reads it.
const ADDED_AT_B94466F9: Record<string, string> = {
  'gc.await_type': 'vk/graph/model.ts',
  'devwork.attachments': 'lib/cardText.ts (screenshots; not shown in Discord, harmless to keep)',
  'devwork.hold_reason': 'vk/graph/boardModel.ts',
  'devwork.intake_needs_person': 'lib/boardNoise.ts',
  'devwork.intake_reason': 'vk/graph/boardModel.ts',
  'devwork.kind': 'components/BeadDetailModal.tsx',
  'devwork.land_bead': 'lib/boardModel.ts, vk/panel/drawerFacts.ts',
  'devwork.pause_reason': 'lib/pause.ts',
  'devwork.plan_status': 'vk/graph/boardModel.ts',
  'devwork.step': 'vk/panel/drawerFacts.ts',
  'devwork.task': 'lib/boardModel.ts, vk/panel/drawerFacts.ts',
  'owner.link': 'lib/ownerQuestions.ts',
};
// Key-shaped literals that are not bead metadata the board reads in Discord.
const NOT_BOARD_METADATA: Record<string, string> = {
  'gc.board-chat.turns.v1': 'the card chat (hooks/useCardChat.ts), not shown in Discord',
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
  const allowed = new Set([...DESIGN_M, ...Object.keys(ADDED_AT_B94466F9)]);
  const found = new Map<string, string>();
  for (const file of walk(srcDir)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(KEY_RE)) {
      const key = m[1]!;
      if (!found.has(key)) found.set(key, relative(srcDir, file));
    }
  }

  it('finds the keys (the scan works)', () => {
    expect(found.has('dashboard.stage')).toBe(true);
    expect(found.has('gc.kind')).toBe(true);
  });

  it('every key is in M, the b94466f9 additions or decision.*', () => {
    const missing = [...found]
      .filter(([k]) => !k.startsWith('decision.') && !allowed.has(k) && !(k in NOT_BOARD_METADATA))
      .map(([k, f]) => `${k} (${f})`);
    expect(missing).toEqual([]);
  });
});
