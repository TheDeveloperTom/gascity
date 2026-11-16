import { describe, expect, it } from 'vitest';
import { peerBody } from '../test/fixtures/peerBoards';
import { parsePeerBoards, PEER_RUNS_SCHEMA } from './peerBoardReads';

// PEER-STAGE (16.11): a peer's `runs` block (its open runs of shared cards,
// city repo boardsync/live_runs.py) is parsed on its own and leniently: a bad
// block or bead never costs the board, it only falls back to today's
// placement (no runs) or marks the runs incomplete.

const ROOT = {
  id: 'gcg-329729',
  status: 'in_progress',
  is_blocked: false,
  issue_type: 'task',
  title: 'devwork-development',
  created_at: '2026-11-16T15:00:00Z',
  metadata: { 'gc.kind': 'workflow', 'gc.var.issue': 'dw-ab12' },
};
const STEP = {
  id: 'gcg-329770',
  status: 'in_progress',
  is_blocked: false,
  issue_type: 'task',
  title: 'Task review until approved',
  created_at: '2026-11-16T15:00:01Z',
  metadata: { 'gc.root_bead_id': 'gcg-329729', 'dashboard.stage': 'review', 'dashboard.label': 'ревью' },
};

const runs = (over: Record<string, unknown> = {}) => ({
  schema: PEER_RUNS_SCHEMA,
  complete: true,
  beads: [ROOT, STEP],
  ...over,
});

const parsed = (block: unknown) => parsePeerBoards(peerBody({ runs: block })).peers[0]!;

describe('parsePeerBoards: the peer runs block (PEER-STAGE)', () => {
  it('keeps the runs as supervisor beads, with the completeness flag', () => {
    const peer = parsed(runs());
    expect(peer.runs?.complete).toBe(true);
    expect(peer.runs?.beads).toEqual([ROOT, STEP]);
  });

  it('a sender without runs (an old city) has none: today\'s placement', () => {
    expect(parsePeerBoards(peerBody()).peers[0]!.runs).toBeNull();
    expect(parsed(null).runs).toBeNull();
  });

  it('an unknown runs schema (a newer city) is ignored, never misread', () => {
    expect(parsed(runs({ schema: 'devwork.live-runs/2' })).runs).toBeNull();
  });

  it('a malformed block is dropped and the board is kept', () => {
    for (const bad of ['x', 42, [], { schema: PEER_RUNS_SCHEMA }, runs({ beads: 'no' }), runs({ complete: 'yes' })]) {
      const peer = parsed(bad);
      expect(peer.runs).toBeNull();
      expect(peer.cards.length).toBeGreaterThan(0);
    }
  });

  it('a malformed bead is skipped and the runs are no longer complete', () => {
    const bad = [
      { ...STEP, id: 'not an id!' },
      { ...STEP, id: 'gcg-1', status: 3 },
      { ...STEP, id: 'gcg-2', is_blocked: 'no' },
      { ...STEP, id: 'gcg-3', metadata: { 'dashboard.stage': 7 } },
      'gcg-4',
    ];
    const peer = parsed(runs({ beads: [ROOT, STEP, ...bad] }));
    expect(peer.runs?.beads.map((b) => b.id)).toEqual(['gcg-329729', 'gcg-329770']);
    expect(peer.runs?.complete).toBe(false);
  });

  it('a bead without optional fields gets the board defaults', () => {
    const peer = parsed(runs({ beads: [{ id: 'gcg-5', status: 'open' }] }));
    expect(peer.runs?.beads[0]).toEqual({ id: 'gcg-5', status: 'open', title: '', issue_type: 'task', created_at: '' });
  });
});
