import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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

function renderPage(contributors: AttentionContributor[] = []) {
  return render(
    <LocaleProvider>
      <MemoryRouter initialEntries={['/beads']}>
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
    const group = screen.getByRole('group', { name: 'Project' });
    fireEvent.click(within(group).getByRole('button', { name: /^City/ }));
    expect(screen.getByText('Приёмка города: часть B')).toBeTruthy();
    expect(screen.queryByText('M04 — приёмка этапа')).toBeNull();
    expect(beadQueries.length).toBe(before);
  });

  it('the project control lists the real rigs and the city', async () => {
    renderPage();
    await screen.findByText('Приёмка города: часть B');
    const names = within(screen.getByRole('group', { name: 'Project' }))
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(names).toEqual(['All 2', 'devwork 1', 'City 1']);
    for (const name of names) expect(name).not.toContain('/r/');
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
    const history = screen.getByRole('button', { name: 'Show all history' });
    fireEvent.click(history);
    await waitFor(() =>
      expect(beadQueries.slice(first).some((q) => q.get('all') === 'true')).toBe(true),
    );
    expect(
      screen.getByRole('button', { name: 'Recent merges only' }).getAttribute('aria-pressed'),
    ).toBe('true');
    const second = beadQueries.length;
    fireEvent.click(screen.getByRole('button', { name: 'Recent merges only' }));
    await waitFor(() => expect(beadQueries.length).toBeGreaterThan(second));
    await waitFor(() => expect(beadQueries.slice(second).some((q) => q.has('all'))).toBe(false));
  });

  it('open groups persist', async () => {
    windowItems = manyWaiting();
    const first = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^M04/ }));
    expect(window.localStorage.getItem('gcd:board:openGroups')).toBe('["milestone:M04"]');
    first.unmount();
    renderPage();
    expect(await screen.findByText('M04 card 0')).toBeTruthy();
  });

  it('storage failure keeps working', async () => {
    windowItems = manyWaiting();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^M04/ }));
    expect(await screen.findByText('M04 card 0')).toBeTruthy();
    expect(screen.queryByText('Dashboard view failed.')).toBeNull();
  });

  it('open groups survive a locale change', async () => {
    windowItems = manyWaiting();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^M04/ }));
    expect(screen.getByText('M04 card 0')).toBeTruthy();
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

  it('the Needs-you panel is a plate', async () => {
    const item: AttentionItem = {
      id: 'beads:decision:dw-d1',
      audience: 'owner',
      domain: 'beads',
      severity: 'attention',
      title: 'Choose the window',
      href: '/beads?bead=dw-d1',
    };
    renderPage([{ id: 'beads:test', domain: 'beads', getItems: () => [item] }]);
    const panel = await screen.findByRole('region', { name: /Needs you/ });
    expect(panel.className).toContain('bg-plate');
  });
});
