import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BeadsPage } from './Beads';
import { invalidate } from '../api/cache';
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

const graphCalls = vi.hoisted(() => [] as Array<{ epicId: string | null; focusIds?: string[] }>);
const graphBeadIds = vi.hoisted(() => ({ last: [] as string[] }));
vi.mock('../vk/graph/model', async (orig) => {
  const real = await orig<typeof import('../vk/graph/model')>();
  return {
    ...real,
    buildGraph: (beads: ReadonlyArray<unknown>, opts: { epicId: string | null; focusIds?: string[]; nowMs: number }) => {
      graphCalls.push({ epicId: opts.epicId, ...(opts.focusIds ? { focusIds: opts.focusIds } : {}) });
      graphBeadIds.last = (beads as SupervisorBead[]).map((b) => b.id);
      // dw-b also carries its own owner question: a separate «<id>::q» card.
      const withQuestions = (beads as SupervisorBead[]).flatMap((b) =>
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
        // The rig's own work store holds a task the unscoped window lacks.
        if (url.searchParams.get('rig') === 'devwork') return json({ items: [...items, R], total: items.length + 1 });
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

afterEach(() => {
  cleanup();
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

  it('with «Все», «Граф» shows the all-tickets placeholder, not the board', async () => {
    renderPage('/beads');
    const group = await screen.findByRole('group', { name: 'View' });
    fireEvent.click(within(group).getByRole('button', { name: 'Graph' }));
    expect(param('view')).toBe('graph');
    await screen.findByTestId('graph-all-placeholder');
    expect(screen.queryByTestId('graph-view')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Board' })).toBeNull();
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

  it('«Show on graph» without an epic focuses the card’s chain', async () => {
    renderPage('/beads?bead=dw-b');
    fireEvent.click(await screen.findByRole('button', { name: 'Show on graph' }));
    expect(param('view')).toBe('graph');
    expect(param('focus')).toBe('dw-b');
  });
});
