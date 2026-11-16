import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BeadsPage } from './Beads';
import { invalidate } from '../api/cache';
import { resetSupervisorApiForTests } from '../supervisor/client';
import { setActiveCity } from '../api/cityBase';
import { AttentionProvider } from '../attention/context';
import { NowProvider } from '../contexts/NowContext';
import { OperatorConfigProvider } from '../contexts/OperatorConfigContext';
import { setLocale } from '../i18n';
import { LocaleProvider } from '../i18n/LocaleProvider';
import type { SupervisorBead } from '../supervisor/beadReads';

// The «Граф» tab (graph sprint 16.11, page lane). The model and the view are
// other lanes' files: both are replaced here by spies that keep the contract
// (buildGraph(beads, {epicId, focusIds, nowMs}); GraphView {model, selectedId,
// onSelect, onAnswer}), so these tests hold for the real files too.

const graphCalls = vi.hoisted(() => [] as Array<{ epicId: string | null; focusIds?: string[]; partial?: boolean }>);
const graphBeadIds = vi.hoisted(() => ({ last: [] as string[] }));
vi.mock('../vk/graph/model', async (orig) => {
  const real = await orig<typeof import('../vk/graph/model')>();
  return {
    ...real,
    buildGraph: (beads: ReadonlyArray<unknown>, opts: { epicId: string | null; focusIds?: string[]; nowMs: number; partial?: boolean }) => {
      graphCalls.push({ epicId: opts.epicId, ...(opts.focusIds ? { focusIds: opts.focusIds } : {}), ...(opts.partial ? { partial: true } : {}) });
      graphBeadIds.last = (beads as SupervisorBead[]).map((b) => b.id);
      // A focus keeps the real model's membership (the chain), so the page's
      // narrowing is observable through the spy view.
      const inChain =
        opts.focusIds !== undefined
          ? new Set(real.buildGraph(beads, opts).nodes.map((n) => real.beadIdOf(n.id)))
          : null;
      const kept = (beads as SupervisorBead[]).filter((b) => inChain === null || inChain.has(b.id));
      // dw-b also carries its own owner question: a separate «<id>::q» card.
      const withQuestions = kept.flatMap((b) =>
        b.id === 'dw-b' ? [{ ...b, id: real.questionNodeId(b.id) }, b] : [b],
      );
      return {
        nodes: withQuestions.map((b, row) => ({
          id: b.id,
          kind: 'task' as const,
          label: b.id,
          title: b.title,
          state: 'free' as const,
          reason: '',
          holds: 0,
          column: 1,
          row,
          outside: false,
          assignee: null,
        })),
        edges: [],
        columns: [],
        headline: '',
        subline: '',
      };
    },
  };
});
vi.mock('../vk/graph/GraphView', () => ({
  GraphView: ({
    model,
    selectedId,
    onSelect,
    onAnswer,
  }: {
    model: { nodes: { id: string; title: string }[] };
    selectedId: string | null;
    onSelect: (id: string) => void;
    onAnswer: (id: string) => void;
  }) => (
    <div data-testid="graph-view" data-selected={selectedId ?? ''}>
      {model.nodes.map((n) => (
        <button key={n.id} type="button" data-graph-node={n.id} onClick={() => onSelect(n.id)}>
          {`node ${n.id}`}
        </button>
      ))}
      {model.nodes
        .filter((n) => n.id.endsWith('::q'))
        .map((n) => (
          <button key={`a-${n.id}`} type="button" onClick={() => onAnswer(n.id)}>
            {`answer ${n.id}`}
          </button>
        ))}
    </div>
  ),
}));


// The all-tickets graph («Эпик: Все» + «Граф»): model and view are spies that
// keep the ALL-README contract (buildBoardGraph(beads, {nowMs, partial,
// collapsed, filter}); BoardGraphView {graph, selectedId, onSelect, onAnswer,
// onToggleLane, onOpenEpic}).
const net = vi.hoisted(() => ({ unscoped: 'ok' as 'ok' | 'hang' | 'restarting', release: [] as Array<() => void> }));
const boardCalls = vi.hoisted(
  () => [] as Array<{ ids: string[]; partial?: boolean; collapsed?: Record<string, boolean>; filter?: string }>,
);
vi.mock('../vk/graph/boardModel', async (orig) => {
  const real = await orig<typeof import('../vk/graph/boardModel')>();
  return {
    ...real,
    buildBoardGraph: (
      beads: ReadonlyArray<{ id: string; title: string }>,
      opts: { partial?: boolean; collapsed?: Record<string, boolean>; filter?: string },
    ) => {
      boardCalls.push({
        ids: beads.map((b) => b.id),
        ...(opts.partial !== undefined ? { partial: opts.partial } : {}),
        ...(opts.collapsed !== undefined ? { collapsed: opts.collapsed } : {}),
        ...(opts.filter !== undefined ? { filter: opts.filter } : {}),
      });
      const collapsed = opts.collapsed?.M04 ?? false;
      return {
        nodes: beads.map((b, row) => ({
          id: b.id, kind: 'task' as const, label: b.id, title: b.title, state: 'free' as const, reason: '',
          holds: 0, column: 1, row, outside: false, assignee: null,
        })),
        edges: [],
        lanes: [{ key: 'M04', title: 'M04', done: 0, total: beads.length, approved: true, collapsed, waitsOnEpics: [], nodeIds: beads.map((b) => b.id) }],
        laneOf: Object.fromEntries(beads.map((b) => [b.id, 'M04'])),
        columns: [],
        headline: '',
        subline: '',
        warnings: [],
      };
    },
  };
});
vi.mock('../vk/graph/BoardGraphView', () => ({
  BoardGraphView: ({
    graph,
    selectedId,
    onSelect,
    onToggleLane,
    onOpenEpic,
  }: {
    graph: { nodes: { id: string }[]; lanes: { key: string; collapsed: boolean }[] };
    selectedId: string | null;
    onSelect: (id: string) => void;
    onToggleLane: (key: string) => void;
    onOpenEpic: (key: string) => void;
  }) => (
    <div data-testid="board-graph-view" data-selected={selectedId ?? ''}>
      {graph.nodes.map((n) => (
        <button key={n.id} type="button" onClick={() => onSelect(n.id)}>
          {`all ${n.id}`}
        </button>
      ))}
      {graph.lanes.map((l) => (
        <span key={l.key}>
          <button type="button" onClick={() => onToggleLane(l.key)}>{`toggle ${l.key} ${l.collapsed ? 'closed' : 'open'}`}</button>
          <button type="button" onClick={() => onOpenEpic(l.key)}>{`epic ${l.key}`}</button>
        </span>
      ))}
    </div>
  ),
}));

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

// M04 #3 waits on M04 #2; M04 #4 waits on M04 #3.
const A = bead('dw-a', { title: 'M04 #2 — Первая', labels: ['milestone:M04'] });
const B = bead('dw-b', {
  title: 'M04 #3 — Вторая',
  labels: ['milestone:M04'],
  dependencies: [{ issue_id: 'dw-b', depends_on_id: 'dw-a', type: 'blocks' }],
});
const C = bead('dw-c', {
  title: 'M04 #4 — Третья',
  labels: ['milestone:M04'],
  dependencies: [{ issue_id: 'dw-c', depends_on_id: 'dw-b', type: 'blocks' }],
});

// Only the rig-scoped read returns this one (live 16.11: the model lane saw 2
// M04 beads unscoped and all of them with rig=devwork).
const R = bead('dw-r', { title: 'M04 #5 — Из рига', labels: ['milestone:M04'] });

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  graphCalls.length = 0;
  boardCalls.length = 0;
  net.unscoped = 'ok';
  setActiveCity('test-city');
  window.localStorage.clear();
  invalidate('beads:board:');
  invalidate('beads:detail');
  invalidate('sessions');
  invalidate('rigs');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  const items = [A, B, C];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
      if (url.pathname === '/v0/city/test-city/beads') {
        const status = url.searchParams.get('status');
        if (status === 'closed' || status === 'in_progress') return json({ items: [], total: 0 });
        // A restarting city answers not_found on every bead read.
        if (net.unscoped === 'restarting') {
          return new Response(
            JSON.stringify({ code: 'not_found', message: 'city not found or not running: test-city' }),
            { status: 404, headers: { 'content-type': 'application/json' } },
          );
        }
        // The rig's own work store holds a task the unscoped window lacks.
        if (url.searchParams.get('rig') === 'devwork') return json({ items: [...items, R], total: items.length + 1 });
        if (net.unscoped === 'hang') {
          return new Promise<Response>((resolve) => net.release.push(() => resolve(json({ items, total: items.length }))));
        }
        return json({ items, total: items.length });
      }
      const one = /^\/v0\/city\/test-city\/bead\/(.+)$/.exec(url.pathname);
      if (one) return json(items.find((b) => b.id === decodeURIComponent(one[1] ?? '')) ?? {});
      if (url.pathname === '/v0/city/test-city/rigs') {
        return json({
          items: [{ name: 'devwork', prefix: 'dw', path: '/r', agent_count: 0, running_count: 0, suspended: false }],
          total: 1,
        });
      }
      if (url.pathname.startsWith('/v0/city/test-city/')) return json({ items: [], total: 0 });
      return json({});
    }),
  );
});

afterEach(async () => {
  cleanup();
  // A held unscoped read must not stay in the shared in-flight map.
  net.release.splice(0).forEach((go) => go());
  await new Promise((r) => setTimeout(r, 0));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  act(() => setLocale('en'));
});

const probe = { search: '' };
function LocationProbe() {
  probe.search = useLocation().search;
  return null;
}
const param = (key: string) => new URLSearchParams(probe.search).get(key);

function renderPage(entry: string) {
  act(() => setLocale('en'));
  return render(
    <LocaleProvider>
      <MemoryRouter initialEntries={[entry]}>
        <LocationProbe />
        <NowProvider intervalMs={1_000_000}>
          <OperatorConfigProvider
            operator={{ operatorAlias: 'owner', operatorWireAlias: 'human', decisionLabel: 'x' }}
          >
            <AttentionProvider contributors={[]}>
              <BeadsPage />
            </AttentionProvider>
          </OperatorConfigProvider>
        </NowProvider>
      </MemoryRouter>
    </LocaleProvider>,
  );
}

describe('BeadsPage «Граф» tab', () => {
  // Owner 16.11: he could not find the graph, the switch only showed with an
  // epic. It is always there; with «Все» the graph view is the all-tickets
  // graph (placeholder until that lane lands).
  it('the Board | Graph switch is shown without an epic too', async () => {
    renderPage('/beads');
    await screen.findByRole('region', { name: 'Board' });
    expect(screen.getByRole('group', { name: 'View' })).toBeTruthy();
  });

  it('with «Все», «Граф» shows the all-tickets graph over the unscoped and rig reads, merged by id', async () => {
    renderPage('/beads');
    const group = await screen.findByRole('group', { name: 'View' });
    fireEvent.click(within(group).getByRole('button', { name: 'Graph' }));
    expect(param('view')).toBe('graph');
    await screen.findByTestId('board-graph-view');
    expect(screen.queryByTestId('graph-all-placeholder')).toBeNull();
    expect(screen.queryByTestId('graph-view')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Board' })).toBeNull();
    await vi.waitFor(() => expect(boardCalls.at(-1)?.ids).toContain('dw-r'));
    expect(boardCalls.at(-1)?.ids.filter((id) => id === 'dw-a')).toHaveLength(1);
  });

  it('all-tickets graph: a card selects (?bead=) and opens the drawer beside the graph', async () => {
    renderPage('/beads?view=graph');
    fireEvent.click(await screen.findByRole('button', { name: 'all dw-b' }));
    expect(param('bead')).toBe('dw-b');
    expect(param('view')).toBe('graph');
    expect((await screen.findByTestId('graph-view')).getAttribute('data-selected')).toBe('dw-b');
    const dialog = await screen.findByRole('dialog', { name: 'Open task' });
    expect(dialog.getAttribute('aria-modal')).toBe('false');
  });

  it('all-tickets graph: the epic name opens that epic’s graph (?epic=)', async () => {
    renderPage('/beads?view=graph');
    fireEvent.click(await screen.findByRole('button', { name: 'epic M04' }));
    expect(param('epic')).toBe('M04');
    expect(param('view')).toBe('graph');
    await screen.findByTestId('graph-view');
  });

  it('all-tickets graph: the lane toggle keeps its collapse state in the page', async () => {
    renderPage('/beads?view=graph');
    fireEvent.click(await screen.findByRole('button', { name: 'toggle M04 open' }));
    await screen.findByRole('button', { name: 'toggle M04 closed' });
    expect(boardCalls.at(-1)?.collapsed).toEqual({ M04: true });
    fireEvent.click(screen.getByRole('button', { name: 'toggle M04 closed' }));
    await screen.findByRole('button', { name: 'toggle M04 open' });
  });

  it('all-tickets graph: the quick filters feed buildBoardGraph', async () => {
    renderPage('/beads?view=graph');
    const filters = await screen.findByRole('group', { name: 'Graph filter' });
    expect(within(filters).getByRole('button', { name: 'Everything' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(filters).getByRole('button', { name: 'Only what holds me' }));
    await vi.waitFor(() => expect(boardCalls.at(-1)?.filter).toBe('holds_me'));
    fireEvent.click(within(filters).getByRole('button', { name: 'Only stuck' }));
    await vi.waitFor(() => expect(boardCalls.at(-1)?.filter).toBe('stuck'));
    fireEvent.click(within(filters).getByRole('button', { name: 'Only in work' }));
    await vi.waitFor(() => expect(boardCalls.at(-1)?.filter).toBe('in_work'));
  });

  it('all-tickets graph: the search box selects the matching card', async () => {
    renderPage('/beads?view=graph');
    await screen.findByTestId('board-graph-view');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Третья' } });
    await vi.waitFor(() => expect(param('bead')).toBe('dw-c'));
    expect(screen.getByTestId('board-graph-view').getAttribute('data-selected')).toBe('dw-c');
  });

  it('with an epic, «Граф» writes ?view=graph and shows the epic graph', async () => {
    renderPage('/beads?epic=M04');
    const group = await screen.findByRole('group', { name: 'View' });
    expect(within(group).getByRole('button', { name: 'Board' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(group).getByRole('button', { name: 'Graph' }));
    expect(param('view')).toBe('graph');
    await screen.findByTestId('graph-view');
    expect(screen.queryByRole('region', { name: 'Board' })).toBeNull();
    expect(graphCalls.at(-1)).toEqual({ epicId: 'M04' });
    fireEvent.click(within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name: 'Board' }));
    expect(param('view')).toBeNull();
    await screen.findByRole('region', { name: 'Board' });
  });

  it('clicking a graph card opens it (?bead=) and keeps the graph', async () => {
    renderPage('/beads?epic=M04&view=graph');
    fireEvent.click(await screen.findByRole('button', { name: 'node dw-b' }));
    expect(param('bead')).toBe('dw-b');
    expect(param('view')).toBe('graph');
    expect(screen.getByTestId('graph-view').getAttribute('data-selected')).toBe('dw-b');
  });

  it('the switch sits in the filter row, right after «Эпик:»', async () => {
    renderPage('/beads?epic=M04');
    const group = await screen.findByRole('group', { name: 'View' });
    expect(group.nextElementSibling).toBe(screen.getByRole('searchbox'));
  });

  it('on the graph the drawer sits beside it (no scrim, not modal); on the board it stays modal', async () => {
    renderPage('/beads?epic=M04&view=graph&bead=dw-b');
    const dialog = await screen.findByRole('dialog', { name: 'Open task' });
    expect(dialog.getAttribute('aria-modal')).toBe('false');
    expect(dialog.parentElement?.className ?? '').not.toContain('bg-scrim');
    cleanup();
    renderPage('/beads?epic=M04&bead=dw-b');
    const modal = await screen.findByRole('dialog', { name: 'Open task' });
    expect(modal.getAttribute('aria-modal')).toBe('true');
  });

  it('a question card («<id>::q») opens its owner task, by click and by «Ответить»', async () => {
    renderPage('/beads?epic=M04&view=graph');
    fireEvent.click(await screen.findByRole('button', { name: 'node dw-b::q' }));
    expect(param('bead')).toBe('dw-b');
    fireEvent.click(screen.getByRole('button', { name: 'node dw-a' }));
    expect(param('bead')).toBe('dw-a');
    fireEvent.click(screen.getByRole('button', { name: 'answer dw-b::q' }));
    expect(param('bead')).toBe('dw-b');
  });

  it('the graph also gets the rig-scoped reads, not only the unscoped window', async () => {
    renderPage('/beads?epic=M04&view=graph');
    await screen.findByTestId('graph-view');
    await vi.waitFor(() => expect(graphBeadIds.last).toContain('dw-r'));
    expect(graphBeadIds.last.filter((id) => id === 'dw-a')).toHaveLength(1);
  });

  it('?focus=<id> draws that node’s chain, with the switch shown', async () => {
    renderPage('/beads?view=graph&focus=dw-b');
    await screen.findByTestId('graph-view');
    expect(graphCalls.at(-1)).toEqual({ epicId: null, focusIds: ['dw-b'] });
    expect(screen.getByRole('group', { name: 'View' })).toBeTruthy();
  });

  it('drawer: «Why it stands» and «Waiting on it» rows move the selection; the crumb goes back', async () => {
    renderPage('/beads?epic=M04&view=graph&bead=dw-b');
    const why = await screen.findByRole('region', { name: 'Why it stands' });
    fireEvent.click(within(why).getByRole('button', { name: /Первая/ }));
    expect(param('bead')).toBe('dw-a');
    expect(param('view')).toBe('graph');
    const back = await screen.findByRole('button', { name: /← M04 #3/ });
    fireEvent.click(back);
    expect(param('bead')).toBe('dw-b');
    const waits = await screen.findByRole('region', { name: 'Waiting on it' });
    fireEvent.click(within(waits).getByRole('button', { name: /Третья/ }));
    expect(param('bead')).toBe('dw-c');
  });

  it('«Show on graph» in the drawer opens the graph with the card selected', async () => {
    renderPage('/beads?epic=M04&bead=dw-b');
    fireEvent.click(await screen.findByRole('button', { name: 'Show on graph' }));
    expect(param('view')).toBe('graph');
    expect(param('bead')).toBe('dw-b');
    await screen.findByTestId('graph-view');
  });

  // Owner 16.11: on the all-tickets graph a card's chain sat far off screen.
  // A click now narrows the graph to that card's chain, side by side.
  it('all-tickets graph: a click narrows the rendered nodes to the card’s chain (?focus=)', async () => {
    renderPage('/beads?view=graph');
    await vi.waitFor(() => expect(boardCalls.at(-1)?.ids).toContain('dw-r'));
    fireEvent.click(await screen.findByRole('button', { name: 'all dw-c' }));
    expect(param('focus')).toBe('dw-c');
    expect(param('bead')).toBe('dw-c');
    const view = await screen.findByTestId('graph-view');
    await vi.waitFor(() => expect(within(view).queryByRole('button', { name: 'node dw-a' })).toBeTruthy());
    expect(within(view).getByRole('button', { name: 'node dw-b' })).toBeTruthy();
    expect(within(view).getByRole('button', { name: 'node dw-c' })).toBeTruthy();
    expect(within(view).queryByRole('button', { name: 'node dw-r' })).toBeNull();
    expect(screen.queryByTestId('board-graph-view')).toBeNull();
    expect(screen.getByText('Chain: dw-c · 3 tasks')).toBeTruthy();
  });

  it('focused chain: Esc restores the full graph and closes the drawer', async () => {
    renderPage('/beads?view=graph');
    await vi.waitFor(() => expect(boardCalls.at(-1)?.ids).toContain('dw-r'));
    fireEvent.click(await screen.findByRole('button', { name: 'all dw-c' }));
    await screen.findByTestId('graph-view');
    await screen.findByRole('dialog', { name: 'Open task' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(param('focus')).toBeNull();
    expect(param('bead')).toBeNull();
    const all = await screen.findByTestId('board-graph-view');
    for (const id of ['dw-a', 'dw-b', 'dw-c', 'dw-r']) {
      await vi.waitFor(() => expect(within(all).getByRole('button', { name: `all ${id}` })).toBeTruthy());
    }
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Open task' })).toBeNull());
  });

  it('focused chain: «← full graph» returns; another card refocuses', async () => {
    renderPage('/beads?view=graph&focus=dw-a&bead=dw-a');
    const view = await screen.findByTestId('graph-view');
    fireEvent.click(within(view).getByRole('button', { name: 'node dw-c' }));
    expect(param('focus')).toBe('dw-c');
    expect(param('bead')).toBe('dw-c');
    fireEvent.click(screen.getByRole('button', { name: '← full graph' }));
    expect(param('focus')).toBeNull();
    expect(param('view')).toBe('graph');
    await screen.findByTestId('board-graph-view');
  });

  it('?focus= round-trips: a reload with it draws the chain and its header', async () => {
    renderPage('/beads?view=graph');
    await vi.waitFor(() => expect(boardCalls.at(-1)?.ids).toContain('dw-r'));
    fireEvent.click(await screen.findByRole('button', { name: 'all dw-b' }));
    const url = `/beads${probe.search}`;
    cleanup();
    renderPage(url);
    const view = await screen.findByTestId('graph-view');
    expect(graphCalls.at(-1)?.focusIds).toEqual(['dw-b']);
    await vi.waitFor(() => expect(within(view).queryByRole('button', { name: 'node dw-r' })).toBeNull());
    expect(await screen.findByText(/^Chain: dw-b · \d+ tasks$/)).toBeTruthy();
  });

  it('«Show on graph» without an epic focuses the card’s chain', async () => {
    renderPage('/beads?bead=dw-b');
    fireEvent.click(await screen.findByRole('button', { name: 'Show on graph' }));
    expect(param('view')).toBe('graph');
    expect(param('focus')).toBe('dw-b');
  });
});

describe('BeadsPage progressive loading and the restarting city', () => {
  it('the board renders as soon as the project’s rig read lands (the unscoped read still pending)', async () => {
    net.unscoped = 'hang';
    renderPage('/beads');
    const board = await screen.findByRole('region', { name: 'Board' });
    expect(within(board).getAllByText(/Вторая/).length).toBeGreaterThan(0);
    expect(screen.getByText('Data still loading…')).toBeTruthy();
    expect(screen.queryByText('Loading beads.')).toBeNull();
  });

  it('the epic graph builds from what has arrived, marked partial', async () => {
    net.unscoped = 'hang';
    renderPage('/beads?epic=M04&view=graph');
    await screen.findByTestId('graph-view');
    expect(graphCalls.at(-1)).toMatchObject({ epicId: 'M04', partial: true });
    expect(screen.getByText('Data still loading…')).toBeTruthy();
  });

  it('the all-tickets graph builds from what has arrived, marked partial', async () => {
    net.unscoped = 'hang';
    renderPage('/beads?view=graph');
    await screen.findByTestId('board-graph-view');
    expect(boardCalls.at(-1)?.partial).toBe(true);
  });

  it('once every read is in, the graphs are not partial', async () => {
    renderPage('/beads?view=graph');
    await screen.findByTestId('board-graph-view');
    await vi.waitFor(() => expect(boardCalls.at(-1)?.partial).toBe(false));
    expect(screen.queryByText('Data still loading…')).toBeNull();
  });

  // BOARD-LOAD 16.11: the fast paint and the graph's rig reads sit beside the
  // full board read, whose city-wide in-progress leg (a Live read, slow under
  // load) covers every rig. With a complete rig window they send no rig-scoped
  // in-progress read of their own; the full board still sends its leg.
  it('rig previews send no in-progress read of their own when the rig window is complete', async () => {
    // The client captures fetch once; rebuild it on this test's stub so the
    // calls below are this page's requests.
    resetSupervisorApiForTests();
    renderPage('/beads?view=graph');
    await screen.findByTestId('board-graph-view');
    await vi.waitFor(() => expect(boardCalls.at(-1)?.partial).toBe(false));
    const beadUrls = () =>
      vi
        .mocked(fetch)
        .mock.calls.map(([input]) => new URL(input instanceof Request ? input.url : String(input), window.location.origin))
        .filter((url) => url.pathname === '/v0/city/test-city/beads');
    const isRigWindow = (u: URL) => u.searchParams.get('rig') === 'devwork' && !u.searchParams.has('status');
    // The old code sent the rig in-progress leg together with the rig window.
    await vi.waitFor(() => expect(beadUrls().filter(isRigWindow).length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    const urls = beadUrls();
    const rigWindows = urls.filter(isRigWindow);
    const rigInProgress = urls.filter(
      (u) => u.searchParams.get('rig') === 'devwork' && u.searchParams.get('status') === 'in_progress',
    );
    const cityInProgress = urls.filter(
      (u) => !u.searchParams.has('rig') && u.searchParams.get('status') === 'in_progress',
    );
    expect(rigWindows.length).toBeGreaterThan(0);
    expect(rigInProgress).toHaveLength(0);
    expect(cityInProgress.length).toBeGreaterThan(0);
  });

  it('a restarting city shows one calm line, not red not_found alerts', async () => {
    net.unscoped = 'restarting';
    renderPage('/beads');
    await screen.findByText('The city is restarting… data will appear in a minute');
    expect(screen.queryByText(/city not found or not running/)).toBeNull();
  });
});
