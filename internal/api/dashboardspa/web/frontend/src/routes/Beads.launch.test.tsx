import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BeadsPage } from './Beads';
import { invalidate } from '../api/cache';
import { setActiveCity } from '../api/cityBase';
import { AttentionProvider } from '../attention/context';
import { NowProvider } from '../contexts/NowContext';
import { OperatorConfigProvider } from '../contexts/OperatorConfigContext';
import { resetPeerBoardsForTests } from '../hooks/usePeerBoards';
import { collectMissing, resetMissing, setLocale } from '../i18n';
import { LocaleProvider } from '../i18n/LocaleProvider';
import type { SupervisorBead } from '../supervisor/beadReads';

// vk-final part 5 (ACTIVITY-LINKS.md §3): the Activity was launched for a
// card. A known id opens its drawer; an unknown one stays on the board,
// clears `bead` from the URL and shows one toast.

const KNOWN: SupervisorBead = {
  id: 'dw-ab12',
  title: 'Известная задача',
  status: 'open',
  issue_type: 'task',
  created_at: '2026-11-15T08:00:00Z',
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  setActiveCity('test-city');
  resetPeerBoardsForTests();
  invalidate('beads:board:');
  invalidate('sessions');
  invalidate('rigs');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
      if (url.pathname === '/v0/city/test-city/beads') return json({ items: [KNOWN], total: 1 });
      if (url.pathname === '/v0/city/test-city/bead/dw-ab12') return json(KNOWN);
      if (url.pathname.startsWith('/v0/city/test-city/bead/')) {
        return json({ status: 404, title: 'Not Found', detail: 'bead not found' }, 404);
      }
      if (url.pathname.startsWith('/v0/city/test-city/')) return json({ items: [], total: 0 });
      return json({});
    }),
  );
  act(() => setLocale('ru'));
  resetMissing();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  act(() => setLocale('en'));
});

let where = '';
function Where() {
  const loc = useLocation();
  where = `${loc.pathname}${loc.search}`;
  return null;
}

function renderLaunch(id: string) {
  return render(
    <LocaleProvider>
      <MemoryRouter
        initialEntries={[{ pathname: '/beads', search: `?frame_id=f1&bead=${id}`, state: { launchBead: id } }]}
      >
        <NowProvider intervalMs={1_000_000}>
          <OperatorConfigProvider operator={{ operatorAlias: 'owner', operatorWireAlias: 'human', decisionLabel: 'x' }}>
            <AttentionProvider contributors={[]}>
              <Routes>
                <Route
                  path="*"
                  element={
                    <>
                      <Where />
                      <BeadsPage />
                    </>
                  }
                />
              </Routes>
            </AttentionProvider>
          </OperatorConfigProvider>
        </NowProvider>
      </MemoryRouter>
    </LocaleProvider>,
  );
}

describe('BeadsPage launched for a card', () => {
  it('a known id opens its drawer', async () => {
    renderLaunch('dw-ab12');
    const dialog = await screen.findByRole('dialog');
    // the panel may open on the id first and fill in once the bead is read
    expect(await within(dialog).findByRole('heading', { name: 'Известная задача' })).toBeTruthy();
  });

  it('an unknown id: one toast, the board stays, bead leaves the URL', async () => {
    renderLaunch('dw-nope');
    const toast = await screen.findByRole('status', { name: 'Уведомление' });
    expect(toast.textContent).toContain('Задача dw-nope не найдена — возможно, закрыта или из другого города');
    await waitFor(() => expect(where).toBe('/beads?frame_id=f1'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Известная задача')).toBeTruthy();
    expect(collectMissing()).toEqual([]);
  });

  it('the phone drawer has «← Доска», which returns to the board', async () => {
    renderLaunch('dw-ab12');
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '← Доска' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
