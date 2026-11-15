import { describe, expect, it } from 'vitest';
import type { PeerComment } from '../../supervisor/peerBoardReads';
import { mergePending } from './CardConversation';

// Review M-8: a sent message shows at once («ждёт доставки») and gives way to
// the served copy. Two identical sends are two messages: one served copy
// replaces one pending row, not both.

function msg(id: string, text: string, createdAt: string, mine = true): PeerComment {
  return {
    id,
    mine,
    author: {
      kind: 'person',
      city: 'me',
      name: 'Артём',
      agent: null,
      displayName: null,
      avatarUrl: null,
      roleCaption: null,
    },
    text,
    summary: null,
    createdAt,
    state: mine ? 'queued' : null,
    reason: null,
    reopened: false,
    undelivered: null,
  };
}

describe('mergePending', () => {
  it('a served copy replaces its pending row', () => {
    const served = [msg('te-1', 'ок?', '2026-11-15T20:00:05Z')];
    const pending = [msg('pending-1', 'ок?', '2026-11-15T20:00:00Z')];
    expect(mergePending(served, pending).map((m) => m.id)).toEqual(['te-1']);
  });

  it('two identical sends with one served copy keep one pending row', () => {
    const served = [msg('te-1', 'ок?', '2026-11-15T20:00:05Z')];
    const pending = [msg('pending-1', 'ок?', '2026-11-15T20:00:00Z'), msg('pending-2', 'ок?', '2026-11-15T20:00:03Z')];
    expect(mergePending(served, pending).map((m) => m.id)).toEqual(['te-1', 'pending-2']);
  });

  it('an older identical message, or one that is not ours, does not hide a new send', () => {
    const served = [msg('te-0', 'ок?', '2026-11-15T19:00:00Z'), msg('te-9', 'ок?', '2026-11-15T20:00:09Z', false)];
    const pending = [msg('pending-1', 'ок?', '2026-11-15T20:00:00Z')];
    expect(mergePending(served, pending).map((m) => m.id)).toEqual(['te-0', 'te-9', 'pending-1']);
  });
});
