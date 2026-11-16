import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BeadsPage } from './Beads';
import { invalidate } from '../api/cache';
import { setActiveCity } from '../api/cityBase';
import { AttentionProvider } from '../attention/context';
import { NowProvider } from '../contexts/NowContext';
import { ReadOnlyProvider } from '../contexts/ReadOnlyContext';
import { OperatorConfigProvider } from '../contexts/OperatorConfigContext';
import { collectMissing, resetMissing, setLocale } from '../i18n';
import { LocaleProvider } from '../i18n/LocaleProvider';
import { refreshPeerBoards, resetPeerBoardsForTests } from '../hooks/usePeerBoards';
import { useNeedsFromMeCount } from '../lib/needsFromMe';
import type { SupervisorBead } from '../supervisor/beadReads';
import { peerBody, peerTopics } from '../test/fixtures/peerBoards';

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

function renderPage(entry = '/beads', readOnly = false) {
  return render(
    <LocaleProvider>
      <MemoryRouter initialEntries={[allProjects(entry)]}>
        <NowProvider intervalMs={1_000_000}>
          <ReadOnlyProvider readOnly={readOnly}>
            <OperatorConfigProvider
              operator={{ operatorAlias: 'owner', operatorWireAlias: 'human', decisionLabel: 'x' }}
            >
              <AttentionProvider contributors={[]}>
                <NeedsCount />
                <BeadsPage />
              </AttentionProvider>
            </OperatorConfigProvider>
          </ReadOnlyProvider>
        </NowProvider>
      </MemoryRouter>
    </LocaleProvider>,
  );
}

const peerCard = () => document.querySelector('[data-card-key="peer:rich:crm-api:dw-ab12"]') as HTMLElement | null;
const myCard = () => document.querySelector('[data-card-key="dw-ab12"]') as HTMLElement | null;

describe('BeadsPage with Richard’s board', () => {
  // H1 16.11 (live sweep, 768 px): the peer line («Мак Ричарда не в сети»,
  // «Обсуждения с городом Ричарда») landed above a board that was already
  // drawn and pushed it down (CLS 0.17). The board waits for the peer read.
  it('the board waits for the peer boards so their lines do not push it down', async () => {
    let release: (r: Response) => void = () => {};
    peerResponse = () => new Promise<Response>((resolve) => (release = resolve)) as unknown as Response;
    renderPage();
    await waitFor(() => expect(requests).toContain('/v0/city/test-city/beads'));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('region', { name: 'Доска' })).toBeNull();
    // The filter bar too: «Проект» joins it once the cards are known and wraps
    // it at 768 px (live deep link: CLS 0.17 with the peer lines under it).
    expect(screen.queryByRole('searchbox', { name: 'Найти задачу' })).toBeNull();
    await act(async () => release(json(peerBody({ snapshotAt: minutesAgo(1) }))));
    expect(await screen.findByRole('region', { name: 'Доска' })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'Найти задачу' })).toBeTruthy();
  });

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

  it('a snapshot older than stale_after_seconds shows «Мак Ричарда не в сети с HH:MM»', async () => {
    const at = minutesAgo(30); // > 1500 s
    peerResponse = () => json(peerBody({ snapshotAt: at }));
    renderPage();
    expect(await screen.findByText(`Мак Ричарда не в сети с ${clock(at)}`)).toBeTruthy();
  });

  it('the threshold comes from the service: 2 minutes old is stale at stale_after_seconds 60', async () => {
    const at = minutesAgo(2);
    peerResponse = () => json({ ...peerBody({ snapshotAt: at }), stale_after_seconds: 60 });
    renderPage();
    expect(await screen.findByText(`Мак Ричарда не в сети с ${clock(at)}`)).toBeTruthy();
  });

  it('a fresh snapshot shows no offline banner', async () => {
    renderPage();
    await screen.findByText('Изменение схемы users');
    expect(screen.queryByText(/не в сети/)).toBeNull();
  });

  // BOARD-LIVE L7: with a live block, «not online» is our own connection state
  it('a live peer offline shows «Мак Ричарда не в сети с HH:MM» from Tailscale LastSeen', async () => {
    const seen = minutesAgo(5);
    peerResponse = () =>
      json(
        peerBody({
          live: {
            version: 3,
            as_of: minutesAgo(6),
            connection: { state: 'offline', since: minutesAgo(4) },
            peer_online: false,
            peer_last_seen: seen,
          },
        }),
      );
    renderPage();
    expect(await screen.findByText(`Мак Ричарда не в сети с ${clock(seen)}`)).toBeTruthy();
  });

  // ---- part 4 (owner, 15.11): a card conversation is a Mayor topic ------

  // Owner, 15.11 (refined): every card gets a plain comment box pinned at the
  // bottom of its drawer. Under it the card's Mayor topic shows as the
  // thread (Mayors and people). The first message opens a topic linked to
  // the card; later ones go into that topic. No separate comment channel.

  function capturePosts() {
    const posts: { path: string; body: Record<string, unknown> }[] = [];
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = new URL(String(input), window.location.origin);
      if ((init?.method ?? 'GET') === 'POST') {
        posts.push({ path: url.pathname, body: JSON.parse(String(init!.body)) as Record<string, unknown> });
        return json({ ok: true }, 201);
      }
      return base(input, init);
    });
    return posts;
  }

  async function openPeerCard() {
    await screen.findByText('Изменение схемы users');
    fireEvent.click(within(peerCard()!).getByRole('button', { name: /Изменение схемы users/ }));
    return screen.findByRole('dialog');
  }

  it('a peer card with a card topic carries «💬 N» (its messages)', async () => {
    peerResponse = () => json(peerBody({ snapshotAt: minutesAgo(1), topics: peerTopics() }));
    renderPage();
    await screen.findByText('Изменение схемы users');
    expect(within(peerCard()!).getByLabelText('Сообщений по карточке: 2').textContent).toBe('2');
  });

  it('his card: the topic shows as the thread; a message goes into that topic', async () => {
    peerResponse = () => json(peerBody({ snapshotAt: minutesAgo(1), topics: peerTopics() }));
    const posts = capturePosts();
    renderPage();
    const dialog = await openPeerCard();
    expect(within(dialog).getByText(/только для чтения/)).toBeTruthy();
    const thread = within(dialog).getByRole('region', { name: 'Обсуждение карточки' });
    expect(within(thread).getByText('Мэр Ричарда')).toBeTruthy();
    expect(within(thread).getByText('Уточняю у Артёма.')).toBeTruthy();
    const box = within(dialog).getByRole('textbox', { name: 'Комментарий к карточке' }) as HTMLTextAreaElement;
    expect(box.placeholder).toBe('Написать Ричарду…');
    // pinned: the composer is in the drawer's footer, outside the scrolling body
    expect(box.closest('[data-testid="task-drawer-footer"]')).not.toBeNull();
    fireEvent.change(box, { target: { value: 'Подождите 0425, пожалуйста' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Отправить' }));
    });
    // one call for every card message; the city posts into the card's topic
    expect(posts).toEqual([
      {
        path: '/v0/city/test-city/svc/peer-boards/v1/topics/card-message',
        body: { card: { city: 'rich', rig: 'crm-api', id: 'dw-ab12' }, text: 'Подождите 0425, пожалуйста' },
      },
    ]);
    expect(await within(dialog).findByText('Подождите 0425, пожалуйста')).toBeTruthy();
    expect(collectMissing()).toEqual([]);
  });

  it('his card with no thread yet: the first message opens a topic linked to the card', async () => {
    peerResponse = () => json(peerBody({ snapshotAt: minutesAgo(1) }));
    const posts = capturePosts();
    renderPage();
    const dialog = await openPeerCard();
    expect(within(dialog).getByText('Пока никто не писал по этой карточке.')).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Комментарий к карточке' }), {
      target: { value: 'Когда вольёте схему?' },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Отправить' }));
    });
    expect(posts).toEqual([
      {
        path: '/v0/city/test-city/svc/peer-boards/v1/topics/card-message',
        body: { card: { city: 'rich', rig: 'crm-api', id: 'dw-ab12' }, text: 'Когда вольёте схему?' },
      },
    ]);
  });

  async function openMyCard() {
    await screen.findByText('Изменение схемы users');
    fireEvent.click(within(myCard()!).getByRole('button', { name: /Моя карточка с тем же id/ }));
    return screen.findByRole('dialog');
  }

  it('OUR card with no own_login yet: our login from a topic OUR service marks mine — the box and thread appear (I-1)', async () => {
    peerResponse = () => json(peerBody({ snapshotAt: minutesAgo(1), topics: peerTopics() }));
    renderPage();
    const dialog = await openMyCard();
    expect(await within(dialog).findByRole('region', { name: 'Обсуждение карточки' })).toBeTruthy();
    expect(within(dialog).getByRole('textbox', { name: 'Комментарий к карточке' })).toBeTruthy();
  });

  it('OUR card, our login truly unknown (no own_login, nothing marked mine): no thread lookup and no box', async () => {
    peerResponse = () => json(peerBody({ snapshotAt: minutesAgo(1) }));
    renderPage();
    const dialog = await openMyCard();
    // the panel has settled on the bead (its body reads the card)
    await within(dialog).findByText('dw-ab12');
    expect(within(dialog).queryByRole('textbox', { name: 'Комментарий к карточке' })).toBeNull();
    expect(within(dialog).queryByRole('region', { name: 'Обсуждение карточки' })).toBeNull();
  });

  it('OUR card whose topic is on BOB’s board (two peers): the message goes to bob, no picker (M-10)', async () => {
    const body = { ...peerBody({ snapshotAt: minutesAgo(1) }), own_login: 'me' };
    const bob = structuredClone(body.peers[0]!) as Record<string, unknown>;
    bob.login = 'bob';
    bob.person = { name: 'Боб', genitive: 'Боба', initial: 'Б', dative: 'Бобу' };
    bob.cards = [];
    bob.topics = [{ ...peerTopics()[1], city: 'me', card: { city: 'me', rig: 'devwork', id: 'dw-ab12' } }];
    body.peers.push(bob as (typeof body.peers)[number]);
    peerResponse = () => json(body);
    const posts = capturePosts();
    renderPage();
    const dialog = await openMyCard();
    await within(dialog).findByRole('region', { name: 'Обсуждение карточки' });
    expect(within(dialog).queryByRole('combobox', { name: 'Кому' })).toBeNull();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Комментарий к карточке' }), {
      target: { value: 'Обновлю сам' },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Отправить' }));
    });
    expect(posts.at(-1)!.body).toEqual({ card: { city: 'me', rig: 'devwork', id: 'dw-ab12' }, text: 'Обновлю сам', to: 'bob' });
  });

  it('read-only dashboard: no comment box (M-5)', async () => {
    peerResponse = () => json(peerBody({ snapshotAt: minutesAgo(1), topics: peerTopics() }));
    renderPage('/beads', true);
    const dialog = await openPeerCard();
    expect(within(dialog).getByRole('region', { name: 'Обсуждение карточки' })).toBeTruthy();
    expect(within(dialog).queryByRole('textbox')).toBeNull();
  });

  it('his urgent card shows «срочно» (M-12)', async () => {
    const body = peerBody({ snapshotAt: minutesAgo(1) });
    (body.peers[0]!.cards[0] as Record<string, unknown>).priority = 1;
    peerResponse = () => json(body);
    renderPage();
    await screen.findByText('Изменение схемы users');
    expect(within(peerCard()!).getByText('срочно')).toBeTruthy();
  });

  it('his board vanishing while «Ричарда» is chosen falls back to «Все», not an empty board (M-1)', async () => {
    renderPage();
    await screen.findByText('Изменение схемы users');
    fireEvent.click(within(screen.getByRole('group', { name: 'Чьи задачи' })).getByRole('button', { name: 'Ричарда' }));
    expect(myCard()).toBeNull();
    peerResponse = () => json({ status: 503 }, 503);
    await act(async () => {
      await refreshPeerBoards();
    });
    await waitFor(() => expect(myCard()).not.toBeNull());
  });

  it('OUR card, one peer, no thread yet: the first message opens a topic with that peer about OUR card', async () => {
    peerResponse = () => json({ ...peerBody({ snapshotAt: minutesAgo(1) }), own_login: 'me' });
    const posts = capturePosts();
    renderPage();
    const dialog = await openMyCard();
    expect(within(dialog).queryByRole('combobox', { name: 'Кому' })).toBeNull();
    fireEvent.change(await within(dialog).findByRole('textbox', { name: 'Комментарий к карточке' }), {
      target: { value: 'Кто возьмёт?' },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Отправить' }));
    });
    expect(posts).toEqual([
      {
        path: '/v0/city/test-city/svc/peer-boards/v1/topics/card-message',
        body: { card: { city: 'me', rig: 'devwork', id: 'dw-ab12' }, text: 'Кто возьмёт?', to: 'rich' },
      },
    ]);
  });

  it('OUR card, two peers, no thread yet: the person picks whom to write to; nothing goes out before', async () => {
    const body = { ...peerBody({ snapshotAt: minutesAgo(1) }), own_login: 'me' };
    const bob = structuredClone(body.peers[0]!) as Record<string, unknown>;
    bob.login = 'bob';
    bob.person = { name: 'Боб', genitive: 'Боба', initial: 'Б', dative: 'Бобу' };
    bob.cards = [];
    body.peers.push(bob as (typeof body.peers)[number]);
    peerResponse = () => json(body);
    const posts = capturePosts();
    renderPage();
    const dialog = await openMyCard();
    const to = (await within(dialog).findByRole('combobox', { name: 'Кому' })) as HTMLSelectElement;
    const box = within(dialog).getByRole('textbox', { name: 'Комментарий к карточке' });
    fireEvent.change(box, { target: { value: 'Кто возьмёт?' } });
    expect((within(dialog).getByRole('button', { name: 'Отправить' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(to, { target: { value: 'bob' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Отправить' }));
    });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual({
      path: '/v0/city/test-city/svc/peer-boards/v1/topics/card-message',
      body: { card: { city: 'me', rig: 'devwork', id: 'dw-ab12' }, text: 'Кто возьмёт?', to: 'bob' },
    });
  });

  it('OUR card: the topic that references it is its thread, with the same box', async () => {
    peerResponse = () => json({ ...peerBody({ snapshotAt: minutesAgo(1), topics: peerTopics() }), own_login: 'me' });
    const posts = capturePosts();
    renderPage();
    await screen.findByText('Изменение схемы users');
    fireEvent.click(within(myCard()!).getByRole('button', { name: /Моя карточка с тем же id/ }));
    const dialog = await screen.findByRole('dialog');
    const thread = await within(dialog).findByRole('region', { name: 'Обсуждение карточки' });
    expect(within(thread).getByText('Кто обновит Node?')).toBeTruthy();
    expect(within(thread).queryByText(/перезагрузить общий CI/)).toBeNull();
    const box = within(dialog).getByRole('textbox', { name: 'Комментарий к карточке' });
    fireEvent.change(box, { target: { value: 'Обновлю сам' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Отправить' }));
    });
    // the topic's peer (the board it came from), never a fallback
    expect(posts.at(-1)).toEqual({
      path: '/v0/city/test-city/svc/peer-boards/v1/topics/card-message',
      body: { card: { city: 'me', rig: 'devwork', id: 'dw-ab12' }, text: 'Обновлю сам', to: 'rich' },
    });
  });

  // BOARD-LIVE L14: both cities use the `dw` prefix and the rig name
  // `devwork`. Our devwork/dw-ab12 and his devwork/dw-ab12 are two cards;
  // opening, commenting, the topic thread and the project filter each hit
  // the right one, keyed by (city, rig, id).
  describe('L14: our devwork/dw-ab12 and his devwork/dw-ab12', () => {
    const HIS_KEY = 'peer:rich:devwork:dw-ab12';
    const hisCard = () => document.querySelector(`[data-card-key="${HIS_KEY}"]`) as HTMLElement | null;
    function collide() {
      const topics = peerTopics() as Record<string, unknown>[];
      topics[0]!.card = { city: 'rich', rig: 'devwork', id: 'dw-ab12' };
      const body = peerBody({ snapshotAt: minutesAgo(1), topics, top: { own_login: 'me' } });
      const card = body.peers[0]!.cards[0] as Record<string, unknown>;
      card.rig = 'devwork';
      peerResponse = () => json(body);
    }

    it('coexist; opening and writing under each reaches its own city', async () => {
      collide();
      const posts = capturePosts();
      renderPage();
      await screen.findByText('Изменение схемы users');
      expect(myCard()).not.toBeNull();
      expect(hisCard()).not.toBeNull();
      // his card: his thread only, and the message names HIS card
      fireEvent.click(within(hisCard()!).getByRole('button', { name: /Изменение схемы users/ }));
      let dialog = await screen.findByRole('dialog');
      let thread = within(dialog).getByRole('region', { name: 'Обсуждение карточки' });
      expect(within(thread).getByText('Уточняю у Артёма.')).toBeTruthy();
      expect(within(thread).queryByText('Кто обновит Node?')).toBeNull();
      fireEvent.change(within(dialog).getByRole('textbox', { name: 'Комментарий к карточке' }), {
        target: { value: 'его' },
      });
      await act(async () => {
        fireEvent.click(within(dialog).getByRole('button', { name: 'Отправить' }));
      });
      expect(posts.at(-1)!.body.card).toEqual({ city: 'rich', rig: 'devwork', id: 'dw-ab12' });
      cleanup();
      // our card: our thread only, and the message names OUR card
      renderPage();
      await screen.findByText('Изменение схемы users');
      fireEvent.click(within(myCard()!).getByRole('button', { name: /Моя карточка с тем же id/ }));
      dialog = await screen.findByRole('dialog');
      thread = await within(dialog).findByRole('region', { name: 'Обсуждение карточки' });
      expect(within(thread).getByText('Кто обновит Node?')).toBeTruthy();
      expect(within(thread).queryByText('Уточняю у Артёма.')).toBeNull();
      fireEvent.change(within(dialog).getByRole('textbox', { name: 'Комментарий к карточке' }), {
        target: { value: 'наш' },
      });
      await act(async () => {
        fireEvent.click(within(dialog).getByRole('button', { name: 'Отправить' }));
      });
      expect(posts.at(-1)!.body.card).toEqual({ city: 'me', rig: 'devwork', id: 'dw-ab12' });
    });

    it('the project filter is (city, rig): our devwork never shows his card, his never shows ours', async () => {
      collide();
      renderPage('/beads?project=devwork');
      await screen.findByText('Моя карточка с тем же id');
      expect(myCard()).not.toBeNull();
      expect(hisCard()).toBeNull();
      cleanup();
      renderPage(`/beads?${new URLSearchParams({ project: 'peer:rich:devwork' })}`);
      await screen.findByText('Изменение схемы users');
      expect(hisCard()).not.toBeNull();
      expect(myCard()).toBeNull();
    });

    it('a link to his card by its board key opens HIS card, never ours', async () => {
      collide();
      renderPage(`/beads?${new URLSearchParams({ bead: HIS_KEY })}`);
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Схема users меняется.')).toBeTruthy();
      expect(within(dialog).getByText(/только для чтения/)).toBeTruthy();
      expect(requests.some((p) => p.includes('/bead/dw-ab12') || p.includes('/beads/dw-ab12'))).toBe(false);
    });
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

// VK 1:1 (16.11): the board opens on the devwork product; these tests read the
// whole board, so they ask for every project unless the entry names one.
function allProjects(entry: string): string {
  if (/[?&]project=/.test(entry)) return entry;
  return `${entry}${entry.includes('?') ? '&' : '?'}project=all`;
}
