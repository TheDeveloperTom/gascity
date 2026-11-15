import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../../i18n';
import { peerSourcesOf } from '../../lib/boardOwner';
import { parsePeerBoards } from '../../supervisor/peerBoardReads';
import { peerBody, peerThread } from '../../test/fixtures/peerBoards';
import { PeerComments } from './PeerComments';
import type * as ActivitySession from '../../embed/activitySession';

// vk-final part 4: a reader in the Activity (Richard) sees the thread but
// gets no composer (canWrite() is the one gate).

const role = vi.hoisted(() => ({ write: true }));
vi.mock('../../embed/activitySession', async (orig) => ({
  ...(await orig<typeof ActivitySession>()),
  canWrite: () => role.write,
}));

function props() {
  const result = parsePeerBoards(peerBody({ threads: [peerThread()] }));
  const peer = peerSourcesOf(result, Date.parse('2026-11-15T19:00:00Z'))[0]!;
  return { peer, rig: 'crm-api', cardId: 'dw-ab12', thread: result.peers[0]!.threads[0], nowMs: Date.now() };
}

beforeEach(() => setLocale('ru'));
afterEach(() => {
  cleanup();
  setLocale('en');
  role.write = true;
});

describe('PeerComments', () => {
  it('the owner gets the composer', () => {
    render(<PeerComments {...props()} />);
    expect(screen.getByRole('textbox', { name: 'Комментарий для Ричарда' })).toBeTruthy();
    // neutral: the transport is about to change, so no promised delay
    expect(screen.getByText('уйдёт в город Ричарда; его Мэр покажет ему')).toBeTruthy();
  });

  it('a reader sees the thread and no composer', () => {
    role.write = false;
    render(<PeerComments {...props()} />);
    expect(screen.getByText('Тесты схемы зелёные')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('no thread yet: an empty note and the composer', () => {
    render(<PeerComments {...props()} thread={undefined} />);
    expect(screen.getByText('Комментариев пока нет.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Комментарий для Ричарда' })).toBeTruthy();
  });
});
