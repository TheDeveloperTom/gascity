import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import type { NavigateFunction } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BeadsPage } from './Beads';
import { invalidate } from '../api/cache';
import { setActiveCity } from '../api/cityBase';
import { AttentionProvider } from '../attention/context';
import type { AttentionContributor, AttentionItem } from '../attention/compose';
import { NowProvider } from '../contexts/NowContext';
import { OperatorConfigProvider } from '../contexts/OperatorConfigContext';
import { collectMissing, resetMissing, setLocale } from '../i18n';
import { LocaleProvider } from '../i18n/LocaleProvider';
import type { SupervisorBead } from '../supervisor/beadReads';
import { m04Idle } from '../test/fixtures/m04Idle';

// B7: the Beads page is one board in Russian with a project control, a
// search, a test-card checkbox and «Вся история». No status chips, no rig
// select, no synopsis, no headings per id prefix.

function bead(id: string, extra: Partial<SupervisorBead> = {}): SupervisorBead {
  return {
    id,
    title: `bead ${id}`,
    status: 'open',
    issue_type: 'task',
    created_at: '2026-11-15T08:00:00Z',
    ...extra,
  };
}

const DP = bead('dp-dh6', { title: 'Приёмка города: часть B' });
const IY = bead('dw-iy9a', { title: 'M04 — приёмка этапа', labels: ['milestone:M04'] });
const ORDER = bead('gcg-ord1', {
  title: 'order:archyl-drift-stage',
  labels: ['order-run:archyl-drift-stage', 'order-tracking'],
});
const DRILL = bead('dw-drill1', {
  title: 'drill27-r28: отказ рекордера на verify-test-passes',
  status: 'closed',
  labels: ['kind:test'],
  updated_at: '2026-11-15T07:00:00Z',
});

const beadQueries: URLSearchParams[] = [];
let windowItems: SupervisorBead[] = [];
let closedItems: SupervisorBead[] = [];

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  setActiveCity('test-city');
  beadQueries.length = 0;
  windowItems = [DP, IY, ORDER];
  closedItems = [];
  window.localStorage.clear();
  invalidate('beads:board:');
  invalidate('sessions');
  invalidate('agents');
  invalidate('rigs');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.origin,
      );
      if (url.pathname === '/v0/city/test-city/beads') {
        beadQueries.push(url.searchParams);
        const status = url.searchParams.get('status');
        if (status === 'closed') return json({ items: closedItems, total: closedItems.length });
        if (status === 'in_progress') {
          const live = windowItems.filter((b) => b.status === 'in_progress');
          return json({ items: live, total: live.length });
        }
        return json({ items: windowItems, total: windowItems.length });
      }
      if (url.pathname === '/v0/city/test-city/rigs') {
        return json({
          items: [
            {
              name: 'devwork',
              prefix: 'dw',
              path: '/r/devwork',
              agent_count: 0,
              running_count: 0,
              suspended: false,
            },
          ],
          total: 1,
        });
      }
      if (url.pathname.startsWith('/v0/city/test-city/')) return json({ items: [], total: 0 });
      return json({});
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  act(() => setLocale('en'));
});

// polish2: the router's current location and navigate(), read by URL tests.
const probe: { search: string; key: string; navigate: NavigateFunction | null } = { search: '', key: '', navigate: null };
function LocationProbe() {
  const location = useLocation();
  probe.search = location.search;
  probe.key = location.key;
  probe.navigate = useNavigate();
  return null;
}

function renderPage(contributors: AttentionContributor[] = [], entry = '/beads') {
  return render(
    <LocaleProvider>
      <MemoryRouter initialEntries={[entry]}>
        <LocationProbe />
        <NowProvider intervalMs={1_000_000}>
          <OperatorConfigProvider
            operator={{ operatorAlias: 'owner', operatorWireAlias: 'human', decisionLabel: 'x' }}
          >
            <AttentionProvider contributors={contributors}>
              <BeadsPage />
            </AttentionProvider>
          </OperatorConfigProvider>
        </NowProvider>
      </MemoryRouter>
    </LocaleProvider>,
  );
}

const manyWaiting = () => [
  ...Array.from({ length: 7 }, (_, i) =>
    bead(`dw-3${i}`, { title: `M03 card ${i}`, labels: ['milestone:M03'] }),
  ),
  ...Array.from({ length: 6 }, (_, i) =>
    bead(`dw-4${i}`, { title: `M04 card ${i}`, labels: ['milestone:M04'] }),
  ),
];

describe('BeadsPage one board', () => {
  it('one board, no store-prefix headings', async () => {
    renderPage();
    await screen.findByText('Приёмка города: часть B');
    expect(screen.getAllByRole('region', { name: 'Board' })).toHaveLength(1);
    for (const name of ['dp', 'dw', 'gcg']) {
      expect(screen.queryByRole('heading', { name })).toBeNull();
    }
    expect(screen.queryByText('order:archyl-drift-stage')).toBeNull();
  });

  it('no status chips and no rig select', async () => {
    renderPage();
    await screen.findByText('Приёмка города: часть B');
    expect(screen.queryByRole('button', { name: 'closed' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Status' })).toBeNull();
    expect(screen.queryByLabelText(/rig filter/i)).toBeNull();
  });

  it('the project filter needs no refetch', async () => {
    renderPage();
    await screen.findByText('Приёмка города: часть B');
    const before = beadQueries.length;
    fireEvent.click(screen.getByRole('button', { name: /Project:/ }));
    fireEvent.click(screen.getByRole('option', { name: /^City \(service\)/ }));
    expect(screen.getByText('Приёмка города: часть B')).toBeTruthy();
    expect(screen.queryByText('M04 — приёмка этапа')).toBeNull();
    expect(beadQueries.length).toBe(before);
  });

  it('the project menu lists the real rigs and the city, with counts', async () => {
    renderPage();
    await screen.findByText('Приёмка города: часть B');
    fireEvent.click(screen.getByRole('button', { name: /Project:/ }));
    const names = within(screen.getByRole('listbox', { name: 'Choose a project' }))
      .getAllByRole('option')
      .map((b) => b.textContent);
    expect(names).toEqual(['All2', 'devwork product1', 'City (service)1']);
    for (const name of names) expect(name).not.toContain('/r/');
  });

  it('?project=city preselects the project', async () => {
    renderPage([], '/beads?project=city');
    await screen.findByText('Приёмка города: часть B');
    expect(screen.queryByText('M04 — приёмка этапа')).toBeNull();
    expect(screen.getByRole('button', { name: /Project:/ }).textContent).toBe('Project: City (service)');
  });

  it('every card carries its project tag when two projects exist', async () => {
    renderPage();
    await screen.findByText('Приёмка города: часть B');
    const card = (id: string) => document.querySelector(`[data-bead-id="${id}"]`) as HTMLElement;
    expect(within(card('dw-iy9a')).getByText('devwork product')).toBeTruthy();
    expect(within(card('dp-dh6')).getByText('City (service)')).toBeTruthy();
  });

  it('test cards stay hidden until asked', async () => {
    closedItems = [DRILL];
    renderPage();
    await screen.findByText('Приёмка города: часть B');
    const box = await screen.findByRole('checkbox', { name: 'Show test tasks (1)' });
    expect((box as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText(DRILL.title)).toBeNull();
    fireEvent.click(box);
    expect(await screen.findByText(DRILL.title)).toBeTruthy();
  });

  it('Show all history widens the fetch', async () => {
    renderPage();
    await screen.findByText('Приёмка города: часть B');
    const first = beadQueries.length;
    // vk lane 1: «Показать старые» under «Влито · за 7 дней» widens the fetch.
    const history = screen.getByRole('button', { name: 'Show older' });
    fireEvent.click(history);
    await waitFor(() =>
      expect(beadQueries.slice(first).some((q) => q.get('all') === 'true')).toBe(true),
    );
    expect(
      screen.getByRole('button', { name: 'Hide older' }).getAttribute('aria-expanded'),
    ).toBe('true');
    const second = beadQueries.length;
    fireEvent.click(screen.getByRole('button', { name: 'Hide older' }));
    await waitFor(() => expect(beadQueries.length).toBeGreaterThan(second));
    await waitFor(() => expect(beadQueries.slice(second).some((q) => q.has('all'))).toBe(false));
  });

  // vk lane 1: the VK columns have no Waiting groups to open or remember, so
  // the three open-group tests became one: a big Waiting shows every card,
  // and survives a locale change.
  it('a big Waiting shows every card and survives a locale change', async () => {
    windowItems = manyWaiting();
    renderPage();
    expect(await screen.findByText('M04 card 0')).toBeTruthy();
    act(() => setLocale('ru'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Задачи' })).toBeTruthy();
    expect(screen.getByText('M04 card 0')).toBeTruthy();
  });

  it('the idle notice from live-shaped data', async () => {
    const input = m04Idle();
    windowItems = [...input.tasks, ...input.routeItems, ...input.serviceItems];
    renderPage();
    expect(await screen.findByText('Nobody is working right now.')).toBeTruthy();
    const link = screen.getByRole('link', {
      name: 'Пакет этапа M04: исполнимый план по мастер-плану §4/§7',
    });
    expect(link.getAttribute('href')).toBe('/beads?bead=dw-4xn4b');
    expect(screen.queryByText(/not tied to a task/)).toBeNull();
  });

  it('Russian page', async () => {
    setLocale('ru');
    resetMissing();
    renderPage();
    await screen.findByText('Приёмка города: часть B');
    expect(screen.getByRole('heading', { level: 1, name: 'Задачи' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Новая задача' })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'Найти задачу' })).toBeTruthy();
    expect(collectMissing()).toEqual([]);
  });

  // vk-final: «Нужно от меня» lives in the top bar with its badge, so the
  // board no longer repeats it as the old navy «Вас ждёт (N)» plate.
  it('an owner item shows no «Вас ждёт» plate on the board (ru, no missing keys)', async () => {
    setLocale('ru');
    resetMissing();
    const item: AttentionItem = {
      id: 'beads:decision:dw-d1',
      audience: 'owner',
      domain: 'beads',
      severity: 'attention',
      title: 'Choose the window',
      href: '/beads?bead=dw-d1',
    };
    renderPage([{ id: 'beads:test', domain: 'beads', getItems: () => [item] }]);
    await screen.findByText('Приёмка города: часть B');
    expect(screen.queryByRole('region', { name: /Вас ждёт/ })).toBeNull();
    expect(screen.queryByText('Choose the window')).toBeNull();
    expect(document.querySelector('.bg-plate')).toBeNull();
    expect(collectMissing()).toEqual([]);
  });
});

// polish2 16.11 (owner): the open card lives in the URL, and the board shows it.
describe('BeadsPage selection in the URL', () => {
  const titleButton = (title: string) => screen.getByRole('button', { name: title });

  it('selecting a card writes ?bead=<id>; closing removes it', async () => {
    renderPage();
    await screen.findByText('M04 — приёмка этапа');
    fireEvent.click(titleButton('M04 — приёмка этапа'));
    await waitFor(() => expect(new URLSearchParams(probe.search).get('bead')).toBe('dw-iy9a'));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(new URLSearchParams(probe.search).has('bead')).toBe(false));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // review M-1: closing a card opened from the board goes back to the entry
  // it came from, so the next Back is not a dead step.
  it('closing a card opened from the board returns to the same history entry', async () => {
    renderPage();
    await screen.findByText('M04 — приёмка этапа');
    const before = probe.key;
    fireEvent.click(titleButton('M04 — приёмка этапа'));
    await screen.findByRole('dialog');
    expect(probe.key).not.toBe(before);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(probe.key).toBe(before);
    expect(new URLSearchParams(probe.search).has('bead')).toBe(false);
  });

  it('after switching cards, closing still lands where the first card was opened from', async () => {
    renderPage();
    await screen.findByText('M04 — приёмка этапа');
    const before = probe.key;
    fireEvent.click(titleButton('M04 — приёмка этапа'));
    await screen.findByRole('dialog');
    fireEvent.click(titleButton('Приёмка города: часть B'));
    await waitFor(() => expect(new URLSearchParams(probe.search).get('bead')).toBe('dp-dh6'));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(probe.key).toBe(before);
  });

  it('re-selecting the open card adds no history entry', async () => {
    renderPage();
    await screen.findByText('M04 — приёмка этапа');
    fireEvent.click(titleButton('M04 — приёмка этапа'));
    await screen.findByRole('dialog');
    const opened = probe.key;
    fireEvent.click(titleButton('M04 — приёмка этапа'));
    expect(probe.key).toBe(opened);
  });

  it('opening a URL with ?bead= selects the card', async () => {
    renderPage([], '/beads?bead=dw-iy9a');
    await screen.findByText('Приёмка города: часть B');
    expect(await screen.findByRole('dialog')).toBeTruthy();
    const card = document.querySelector('[data-bead-id="dw-iy9a"]') as HTMLElement;
    expect(card.getAttribute('aria-current')).toBe('true');
  });

  it('Back after opening a card closes it; Forward opens it again', async () => {
    renderPage();
    await screen.findByText('M04 — приёмка этапа');
    fireEvent.click(titleButton('M04 — приёмка этапа'));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    act(() => {
      void probe.navigate!(-1);
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(new URLSearchParams(probe.search).has('bead')).toBe(false);
    act(() => {
      void probe.navigate!(1);
    });
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(new URLSearchParams(probe.search).get('bead')).toBe('dw-iy9a');
  });

  it('the selected card is marked aria-current with a visible ring and tint; others are not', async () => {
    renderPage();
    await screen.findByText('M04 — приёмка этапа');
    fireEvent.click(titleButton('M04 — приёмка этапа'));
    await screen.findByRole('dialog');
    const card = (id: string) => document.querySelector(`[data-bead-id="${id}"]`) as HTMLElement;
    expect(card('dw-iy9a').getAttribute('aria-current')).toBe('true');
    expect(card('dw-iy9a').className).toContain('ring-2');
    expect(card('dw-iy9a').className).toContain('bg-vk-brand/10');
    expect(card('dp-dh6').hasAttribute('aria-current')).toBe(false);
  });
});

describe('BeadsPage project names (polish2 16.11)', () => {
  it('Russian: «Все», «Продукт devwork», «Город (служебное)», «Проект:», «Найти задачу…»', async () => {
    setLocale('ru');
    renderPage();
    await screen.findByText('Приёмка города: часть B');
    const button = screen.getByRole('button', { name: /Проект:/ });
    expect(button.textContent).toBe('Проект: Все');
    fireEvent.click(button);
    const names = within(screen.getByRole('listbox', { name: 'Выбрать проект' }))
      .getAllByRole('option')
      .map((b) => b.textContent);
    expect(names).toEqual(['Все2', 'Продукт devwork1', 'Город (служебное)1']);
    expect(screen.getByPlaceholderText('Найти задачу…')).toBeTruthy();
  });
});
