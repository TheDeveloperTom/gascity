import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SupervisorApiError } from '../supervisor/errors';
import { CardChat } from '../vk/chat/CardChat';
import { BeadDetailModal } from './BeadDetailModal';

const api = vi.hoisted(() => ({
  sendTurn: vi.fn(),
  getPending: vi.fn(async () => []),
  retryTurn: vi.fn(),
  readThread: vi.fn(async () => []),
  readBinding: vi.fn(async () => null),
  lookupSession: vi.fn(async () => null),
}));
vi.mock('../supervisor/boardChat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../supervisor/boardChat')>();
  return { ...actual, ...api };
});
const beads = vi.hoisted(() => ({ fetchSupervisorBead: vi.fn() }));
vi.mock('../supervisor/beadReads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../supervisor/beadReads')>();
  return { ...actual, ...beads };
});
vi.mock('../contexts/NowContext', () => ({ useNow: () => 1_700_000_000_000 }));
vi.mock('../hooks/useEntityLinks', () => ({ useEntityLinks: vi.fn(() => ({ view: null, loading: false, error: null })) }));
vi.mock('../hooks/useBoardData', () => ({
  useBoardData: vi.fn(() => ({ data: undefined, sessions: [], rigs: [], loading: true, error: null })),
}));
vi.mock('../hooks/useGcEvents', () => ({ useGcEventRefresh: () => 'open' }));
vi.mock('../hooks/useStructuredSessionStream', () => ({
  useStructuredSessionStream: () => ({
    status: 'ready',
    result: { provider: 'claude', template: 'desk', history: null, items: [], activity: 'idle' },
    stream: { status: 'open' },
  }),
}));

afterEach(() => cleanup());

const beadA = {
  id: 'dw-own',
  title: 'own',
  status: 'open',
  issue_type: 'task',
  priority: 2,
  created_at: '2026-11-19T10:00:00Z',
  description: 'x',
};

// PR #3 review I-1: useBeadDetail resets `bead` in an effect, so the first
// render after the drawer moves from our card to an id we do not hold still
// carries the previous bead. Our private chat must not mount for that id even
// for one commit (it would read its thread, pending turns and binding).
describe('stale bead window', () => {
  it('own card open, then a bare id not in our store: our chat never mounts for it', async () => {
    beads.fetchSupervisorBead.mockImplementation(async (id: string) => {
      if (id === 'dw-own') return beadA;
      throw new SupervisorApiError(404, 'not found', undefined);
    });
    const el = (id: string) => (
      <BeadDetailModal open onClose={() => {}} beadId={id} boardCard footer={<CardChat key={id} city="devwork" card={{ rig: 'dw', id }} />} />
    );
    const r = render(el('dw-own'));
    await act(async () => {});
    // our own card: its chat mounted and read its thread
    expect((api.readThread.mock.calls as unknown[][]).map((c) => c[1])).toContain('dw-own');
    api.readThread.mockClear();
    api.getPending.mockClear();
    api.readBinding.mockClear();
    r.rerender(el('dw-d43'));
    await act(async () => {});
    expect(api.readThread).not.toHaveBeenCalled();
    expect(api.getPending).not.toHaveBeenCalled();
    expect(api.readBinding).not.toHaveBeenCalled();
  });
});
