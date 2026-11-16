import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import type { TaskStages } from '../../hooks/useTaskStages';
import { setLocale } from '../../i18n';
import { needsFromBoard } from '../../lib/needsFromMe';
import { NOW_MS, OWNER_ITEMS, QUESTION_ID, needsBoard } from './needsFixture';
import { NeedsSection } from './NeedsSection';

// Owner 16.11: a question opens its card in the board's right-side drawer on
// this same page; the page does not move to the board. The drawer itself
// (BeadDetailModal) reads the network, so it is a stub over the real TaskDrawer.
vi.mock('../../components/BeadDetailModal', async () => {
  const { TaskDrawer } = await import('../panel/TaskDrawer');
  return {
    BeadDetailModal: ({
      open,
      onClose,
      beadId,
    }: {
      open: boolean;
      onClose: () => void;
      beadId: string | null;
    }) => <TaskDrawer open={open} onClose={onClose} title={<span data-testid="drawer-bead">{beadId}</span>} />,
  };
});

const STAGES: TaskStages = { state: 'ready', inFlight: [], queued: 0, outsideWindow: 0 };

let location: ReturnType<typeof useLocation> | null = null;
function LocationProbe() {
  location = useLocation();
  return null;
}

function show(entry = '/') {
  const model = needsFromBoard(needsBoard(), [], [], NOW_MS, false, OWNER_ITEMS);
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <NeedsSection model={model} stages={STAGES} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function questionLink(): HTMLElement {
  const item = document.querySelector<HTMLElement>(`[data-need="${QUESTION_ID}"]`)!;
  return within(item).getAllByRole('link')[0]!;
}

describe('«Нужно от меня»: a question opens in the drawer', () => {
  beforeEach(() => setLocale('ru'));
  afterEach(() => {
    cleanup();
    setLocale('en');
    location = null;
  });

  it('clicking a question opens the drawer on this page and does not go to the board', () => {
    show();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(questionLink());
    expect(location?.pathname).toBe('/');
    expect(new URLSearchParams(location?.search).get('bead')).toBe(QUESTION_ID);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('drawer-bead').textContent).toBe(QUESTION_ID);
    // the list stays on the page under the drawer
    expect(document.querySelector(`[data-need="${QUESTION_ID}"]`)).not.toBeNull();
  });

  it('?bead=<id> in the URL opens the drawer on load (back / reload)', () => {
    show(`/?bead=${QUESTION_ID}`);
    expect(within(screen.getByRole('dialog')).getByTestId('drawer-bead').textContent).toBe(QUESTION_ID);
  });

  it('Esc closes the drawer and clears the selection from the URL', () => {
    show();
    fireEvent.click(questionLink());
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(new URLSearchParams(location?.search).get('bead')).toBeNull();
    expect(location?.pathname).toBe('/');
  });
});
