import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { useBeadDetail, type BeadDetailState } from '../hooks/useBeadDetail';
import { useEntityLinks } from '../hooks/useEntityLinks';
import { CardChat } from '../vk/chat/CardChat';
import { BeadDetailModal } from './BeadDetailModal';

vi.mock('../hooks/useBeadDetail', () => ({
  useBeadDetail: vi.fn(),
}));

vi.mock('../hooks/useEntityLinks', () => ({
  useEntityLinks: vi.fn(() => ({
    view: null,
    loading: false,
    error: null,
  })),
}));

// The task panel reads the shared board (links, agents); no network in this test.
vi.mock('../hooks/useBoardData', () => ({
  useBoardData: vi.fn(() => ({ data: undefined, sessions: [], rigs: [], loading: true, error: null })),
}));

const mockUseBeadDetail = useBeadDetail as unknown as Mock;
const mockUseEntityLinks = useEntityLinks as unknown as Mock;

function detailState(overrides: Partial<BeadDetailState>): BeadDetailState {
  return {
    bead: null,
    loading: false,
    error: null,
    notFound: false,
    now: 1_700_000_000_000,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockUseEntityLinks.mockReturnValue({ view: null, loading: false, error: null });
});

describe('BeadDetailModal', () => {
  it('renders a calm resolved-or-removed state for a stale deep-link (404)', () => {
    mockUseBeadDetail.mockReturnValue(detailState({ notFound: true }));

    render(<BeadDetailModal open onClose={() => {}} beadId="gc-316879" />);

    expect(screen.getByText(/resolved or removed/i)).toBeTruthy();
    // Never the hard "Bead not found in the supervisor." error, and never the
    // maroon accent for what is an expected absence.
    expect(screen.queryByText(/not found in the supervisor/i)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // BOARD-CHAT C4 (owner 19.11 point 6): while the card's data loads, the
  // drawer never shows a different box (the Discord «Сообщение Мэру» box
  // looked like the comments had been deleted).
  const bead = {
    id: 'dw-1',
    title: 'Вход по ссылке',
    status: 'open',
    issue_type: 'task',
    priority: 2,
    created_at: '2026-11-19T10:00:00Z',
  } as unknown as NonNullable<BeadDetailState['bead']>;

  it('test_own_card_never_falls_back_to_mayor_box', () => {
    mockUseBeadDetail.mockReturnValue(detailState({ bead }));
    // the peer read is pending: Beads passes the chat with an unknown rig
    render(
      <BeadDetailModal
        open
        onClose={() => {}}
        beadId="dw-1"
        boardCard
        footer={<CardChat city="devwork" card={{ rig: null, id: 'dw-1' }} />}
      />,
    );
    expect(screen.getByTestId('card-chat-skeleton')).toBeTruthy();
    expect(screen.queryByTestId('mayor-message')).toBeNull();
  });

  it('a board card with no footer shows no box at all', () => {
    mockUseBeadDetail.mockReturnValue(detailState({ bead }));
    render(<BeadDetailModal open onClose={() => {}} beadId="dw-1" boardCard footer={null} />);
    expect(screen.queryByTestId('mayor-message')).toBeNull();
    expect(screen.queryByTestId('task-drawer-footer')).toBeNull();
  });

  it('other callers keep the Mayor box when they pass no footer', () => {
    mockUseBeadDetail.mockReturnValue(detailState({ bead }));
    render(<BeadDetailModal open onClose={() => {}} beadId="dw-1" />);
    expect(screen.getByTestId('mayor-message')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Discuss with the Mayor' })).toBeTruthy();
  });

  // review Q4 (owner 19.11: no «позвать Мэра»): the own card's one Mayor path is its chat
  it('a board card shows no «Обсудить с Мэром» link', () => {
    mockUseBeadDetail.mockReturnValue(detailState({ bead }));
    render(
      <BeadDetailModal open onClose={() => {}} beadId="dw-1" boardCard footer={<CardChat city="devwork" card={{ rig: null, id: 'dw-1' }} />} />,
    );
    expect(screen.queryByRole('button', { name: 'Discuss with the Mayor' })).toBeNull();
  });

  it('still surfaces genuine errors via the alert role', () => {
    mockUseBeadDetail.mockReturnValue(detailState({ error: '500 supervisor down' }));

    render(<BeadDetailModal open onClose={() => {}} beadId="gc-1" />);

    expect(screen.getByRole('alert').textContent).toContain('supervisor down');
  });
});
