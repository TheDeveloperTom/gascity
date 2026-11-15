import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BeadsPage } from './Beads';
import { invalidate } from '../api/cache';
import { setActiveCity } from '../api/cityBase';
import { AttentionProvider } from '../attention/context';
import { NowProvider } from '../contexts/NowContext';
import { OperatorConfigProvider } from '../contexts/OperatorConfigContext';
import { collectMissing, resetMissing, setLocale } from '../i18n';
import { LocaleProvider } from '../i18n/LocaleProvider';
import { resetPeerBoardsForTests } from '../hooks/usePeerBoards';
import { useNeedsFromMeCount } from '../lib/needsFromMe';
import type { SupervisorBead } from '../supervisor/beadReads';
import { peerBody, peerThread, peerTopics } from '../test/fixtures/peerBoards';

// vk-final part 3 (SYNC-PLAN Task 5): Richard's board is a second, read-only
// source. Review focus 1 and 2: the same id on both boards stays two cards,
// the peer window never reads our bead API, and his owner questions never
// count in «Нужно от меня».

const PEER_URL = '/v0/city/test-city/svc/peer-boards/v1/boards';

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

const MINE = bead('dw-ab12', { title: 'Моя карточка с тем же id' });
const requests: string[] = [];
let peerResponse: () => Response;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const clock = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

beforeEach(() => {
  setActiveCity('test-city');
  requests.length = 0;
  peerResponse = () => json(peerBody({ snapshotAt: minutesAgo(1) }));
  window.localStorage.clear();
  invalidate('beads:board:');
  invalidate('sessions');
  invalidate('agents');
  invalidate('rigs');
  resetPeerBoardsForTests();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
      requests.push(url.pathname);
      if (url.pathname === PEER_URL) return peerResponse();
      if (url.pathname === '/v0/city/test-city/beads') {
        return json({ items: [MINE], total: 1 });
      }
      if (url.pathname === '/v0/city/test-city/rigs') {
        return json({
          items: [{ name: 'devwork', prefix: 'dw', path: '/r/devwork', agent_count: 0, running_count: 0, suspended: false }],
          total: 1,
        });
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  act(() => setLocale('en'));
});

let needsCount = -1;
function NeedsCount() {
  needsCount = useNeedsFromMeCount();
  return null;
}

function renderPage(entry = '/beads') {
  return render(
    <LocaleProvider>
      <MemoryRouter initialEntries={[entry]}>
        <NowProvider intervalMs={1_000_000}>
          <OperatorConfigProvider
            operator={{ operatorAlias: 'owner', operatorWireAlias: 'human', decisionLabel: 'x' }}
          >
            <AttentionProvider contributors={[]}>
              <NeedsCount />
              <BeadsPage />
            </AttentionProvider>
          </OperatorConfigProvider>
        </NowProvider>
      </MemoryRouter>
    </LocaleProvider>,
  );
}

const peerCard = () => document.querySelector('[data-card-key="peer:rich:crm-api:dw-ab12"]') as HTMLElement | null;
const myCard = () => document.querySelector('[data-card-key="dw-ab12"]') as HTMLElement | null;

describe('BeadsPage with Richard’s board', () => {
  it('«Все / Мои / Ричарда» turn on with peer data and show both, mine, his', async () => {
    renderPage();
    await screen.findByText('Изменение схемы users');
    const group = screen.getByRole('group', { name: 'Чьи задачи' });
    const his = within(group).getByRole('button', { name: 'Ричарда' }) as HTMLButtonElement;
    expect(his.disabled).toBe(false);
    expect(myCard()).not.toBeNull();
    expect(peerCard()).not.toBeNull();
    fireEvent.click(within(group).getByRole('button', { name: 'Мои' }));
    expect(peerCard()).toBeNull();
    expect(myCard()).not.toBeNull();
    fireEvent.click(his);
    expect(peerCard()).not.toBeNull();
    expect(myCard()).toBeNull();
    expect(collectMissing()).toEqual([]);
  });

  it('a peer card shows «Ричарда», avatar «Р», its project and «на HH:MM», and no «нужен ты»', async () => {
    const at = minutesAgo(1);
    peerResponse = () => json(peerBody({ snapshotAt: at }));
    renderPage();
    await screen.findByText('Изменение схемы users');
    const card = peerCard()!;
    expect(within(card).getByText('Ричарда')).toBeTruthy();
    expect(within(card).getByLabelText('Карточка Ричарда').textContent).toBe('Р');
    // design Main: the rig heads the card and is its project tag
    expect(within(card).getAllByText('crm-api')).toHaveLength(2);
    expect(within(card).getByText(`на ${clock(at)}`)).toBeTruthy();
    expect(within(card).queryByText('нужен ты')).toBeNull();
  });

  it('the same id on both boards is two cards; the peer window never reads our bead API', async () => {
    renderPage();
    await screen.findByText('Изменение схемы users');
    expect(myCard()).not.toBeNull();
    expect(peerCard()).not.toBeNull();
    const before = requests.length;
    fireEvent.click(within(peerCard()!).getByRole('button', { name: /Изменение схемы users/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Схема users меняется.')).toBeTruthy();
    expect(within(dialog).getByText(/только для чтения/)).toBeTruthy();
    // read-only: no discuss, no close, no answer
    expect(within(dialog).queryByRole('button', { name: /Обсудить/ })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /Закрыть задачу/ })).toBeNull();
    expect(within(dialog).queryByTestId('question-card')).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    const after = requests.slice(before);
    expect(after.some((p) => p.includes('/bead/dw-ab12') || p.includes('/beads/dw-ab12'))).toBe(false);
  });

  it('his needs/operator card never counts in «Нужно от меня»', async () => {
    renderPage();
    await screen.findByText('Изменение схемы users');
    await waitFor(() => expect(needsCount).toBe(0));
  });

  it('a paused Mayor topic («нужен человек») counts in «Нужно от меня»; unread alone does not', async () => {
    peerResponse = () => json(peerBody({ snapshotAt: minutesAgo(1), topics: peerTopics() }));
    renderPage();
    await screen.findByText('Изменение схемы users');
    await waitFor(() => expect(needsCount).toBe(1));
  });

  it('«Обсуждения с городом Ричарда» opens the topics; ?topics=&topic= opens one directly', async () => {
    peerResponse = () => json(peerBody({ snapshotAt: minutesAgo(1), topics: peerTopics() }));
    renderPage();
    await screen.findByText('Изменение схемы users');
    const open = screen.getByRole('button', { name: /Обсуждения с городом Ричарда/ });
    // one paused + one unread need attention
    expect(open.textContent).toContain('2');
    fireEvent.click(open);
    const dialog = await screen.findByRole('dialog', { name: 'Обсуждения Мэров' });
    expect(within(dialog).getByText('Перезагрузка общего CI в 22:00')).toBeTruthy();
    cleanup();
    resetPeerBoardsForTests();
    renderPage('/beads?topics=rich&topic=tp-cccccccccccccccccccc');
    const direct = await screen.findByRole('dialog', { name: 'Обсуждения Мэров' });
    expect(within(direct).getByRole('heading', { name: 'Ключ Clerk' })).toBeTruthy();
  });

  it('a snapshot older than stale_after_seconds shows «Мак Ричарда не на связи с HH:MM»', async () => {
    const at = minutesAgo(30); // > 1500 s
    peerResponse = () => json(peerBody({ snapshotAt: at }));
    renderPage();
    expect(await screen.findByText(`Мак Ричарда не на связи с ${clock(at)}`)).toBeTruthy();
  });

  it('the threshold comes from the service: 2 minutes old is stale at stale_after_seconds 60', async () => {
    const at = minutesAgo(2);
    peerResponse = () => json({ ...peerBody({ snapshotAt: at }), stale_after_seconds: 60 });
    renderPage();
    expect(await screen.findByText(`Мак Ричарда не на связи с ${clock(at)}`)).toBeTruthy();
  });

  it('a fresh snapshot shows no offline banner', async () => {
    renderPage();
    await screen.findByText('Изменение схемы users');
    expect(screen.queryByText(/не на связи/)).toBeNull();
  });

  // ---- part 4: comments on his cards ----------------------------------

  it('a peer card with a thread carries «💬 N»', async () => {
    peerResponse = () => json(peerBody({ snapshotAt: minutesAgo(1), threads: [peerThread()] }));
    renderPage();
    await screen.findByText('Изменение схемы users');
    expect(within(peerCard()!).getByLabelText('Комментарии: 6').textContent).toBe('6');
  });

  it('the peer window shows «Комментарии» and sends «Написать Ричарду…» through the city service', async () => {
    peerResponse = () => json(peerBody({ snapshotAt: minutesAgo(1), threads: [peerThread()] }));
    const posts: { url: string; init: RequestInit }[] = [];
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/svc/peer-boards/v1/comments')) {
        posts.push({ url, init: init! });
        return json({ comment: { id: 'xc-new', text: 'Готово?', created_at: new Date().toISOString(), state: 'queued' } }, 201);
      }
      return base(input, init);
    });
    renderPage();
    await screen.findByText('Изменение схемы users');
    fireEvent.click(within(peerCard()!).getByRole('button', { name: /Изменение схемы users/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: /Комментарии/ })).toBeTruthy();
    expect(within(dialog).getByText('Тесты схемы зелёные')).toBeTruthy();
    const box = within(dialog).getByRole('textbox', { name: 'Комментарий для Ричарда' }) as HTMLTextAreaElement;
    expect(box.placeholder).toBe('Написать Ричарду…');
    fireEvent.change(box, { target: { value: 'Готово?' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Отправить' }));
    });
    expect(posts).toHaveLength(1);
    expect((posts[0]!.init.headers as Record<string, string>)['X-GC-Request']).toBe('1');
    expect(JSON.parse(String(posts[0]!.init.body))).toEqual({
      target: { kind: 'card', city: 'rich', rig: 'crm-api', id: 'dw-ab12' },
      text: 'Готово?',
    });
    const sent = await within(dialog).findByText('Готово?', { selector: 'p' });
    const row = sent.closest('[data-testid="comment"]') as HTMLElement;
    expect(within(row).queryByText('ждёт доставки') ?? within(dialog).getAllByText('ждёт доставки').at(-1)).toBeTruthy();
    expect(collectMissing()).toEqual([]);
  });

  it('no peer service: the owner chips stay off and nothing breaks', async () => {
    peerResponse = () => json({ status: 404 }, 404);
    renderPage();
    await screen.findByText('Моя карточка с тем же id');
    const group = screen.getByRole('group', { name: 'Чьи задачи' });
    expect((within(group).getByRole('button', { name: 'Ричарда' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
