import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectMissing, resetMissing, setLocale } from '../../i18n';
import { asOfClock, peerSourcesOf } from '../../lib/boardOwner';
import { parsePeerBoards } from '../../supervisor/peerBoardReads';
import { ownerQuestion, peerBody, peerTopics, QUESTION_JUMP } from '../../test/fixtures/peerBoards';
import { ReadOnlyProvider } from '../../contexts/ReadOnlyContext';
import { TopicsPanel } from './TopicsPanel';
import type * as PeerCommentWrites from '../../supervisor/peerCommentWrites';

// vk-final part 4: «Обсуждения Мэров» with the peer city (frames
// General-Thread, Phone-Topics; the city's final contract in
// topics-report.md). The Mayors talk; people watch and can step in.

const writes = vi.hoisted(() => ({ action: vi.fn(), read: vi.fn() }));
vi.mock('../../supervisor/peerCommentWrites', async (orig) => ({
  ...(await orig<typeof PeerCommentWrites>()),
  postTopicAction: writes.action,
  markTopicRead: writes.read,
}));
const role = { write: true };

const NOW = Date.parse('2026-11-15T19:00:00Z');
const OPEN = { city: 'rich', topicId: 'tp-aaaaaaaaaaaaaaaaaaaa' };

function setup(selected: string | null = null, onSelect = vi.fn(), ownLogin: string | null = 'me') {
  const result = parsePeerBoards(peerBody({ topics: peerTopics() }));
  const peer = peerSourcesOf(result, NOW)[0]!;
  // the dashboard's read-only posture (the only write gate since owner 16.11)
  render(
    <ReadOnlyProvider readOnly={!role.write}>
      <MemoryRouter>
        <TopicsPanel
          open
          onClose={vi.fn()}
          peer={peer}
          topics={result.peers[0]!.topics}
          selectedTopicId={selected}
          onSelectTopic={onSelect}
          nowMs={NOW}
          ownLogin={ownLogin}
        />
      </MemoryRouter>
    </ReadOnlyProvider>,
  );
  return { onSelect };
}

beforeEach(() => {
  setLocale('ru');
  resetMissing();
  writes.action.mockReset().mockResolvedValue(undefined);
  writes.read.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  setLocale('en');
  role.write = true;
});

const list = () => screen.getByRole('navigation', { name: 'Обсуждения' });
const pane = () => screen.getByRole('region', { name: 'Обсуждение' });

describe('TopicsPanel list', () => {
  it('«Открытые», «На паузе» and a collapsed «Решённые · 14 дней»', () => {
    setup();
    const nav = list();
    expect(within(nav).getByText('Обсуждения Мэров')).toBeTruthy();
    expect(within(nav).getByText('с городом Ричарда')).toBeTruthy();
    expect(within(nav).getByText('Открытые')).toBeTruthy();
    expect(within(nav).getByText('Перезагрузка общего CI в 22:00')).toBeTruthy();
    expect(within(nav).getByText('1 новое')).toBeTruthy();
    // the preview is the message summary
    expect(within(nav).getByText('Можно ли в 22:00 перезагрузить CI?')).toBeTruthy();
    expect(within(nav).getByText('На паузе')).toBeTruthy();
    expect(within(nav).getByText('Ночная сборка')).toBeTruthy();
    const resolved = within(nav).getByRole('button', { name: /Решённые · 14 дней/ });
    expect(resolved.getAttribute('aria-expanded')).toBe('false');
    expect(within(nav).queryByText('Ключ Clerk')).toBeNull();
    fireEvent.click(resolved);
    expect(within(nav).getByText('Ключ Clerk')).toBeTruthy();
    expect(within(nav).getByText('→ договорились, решено без задачи')).toBeTruthy();
    expect(collectMissing()).toEqual([]);
  });

  it('paused by the rails: «Мэры не договорились — нужен человек», «Продолжить», «Решить самому»', async () => {
    const { onSelect } = setup();
    const banner = within(list()).getByRole('status');
    expect(banner.textContent).toContain('Мэры не договорились — нужен человек');
    await act(async () => {
      fireEvent.click(within(banner).getByRole('button', { name: 'Продолжить' }));
    });
    expect(writes.action).toHaveBeenCalledWith(
      { city: 'me', topicId: 'tp-bbbbbbbbbbbbbbbbbbbb' },
      { action: 'continue' },
    );
    fireEvent.click(within(banner).getByRole('button', { name: 'Решить самому' }));
    expect(onSelect).toHaveBeenCalledWith('tp-bbbbbbbbbbbbbbbbbbbb');
  });

  it('people do not open topics (city contract c664ac8f): no «Новое обсуждение»', () => {
    setup();
    expect(screen.queryByRole('button', { name: /Новое обсуждение/ })).toBeNull();
  });
});

describe('TopicsPanel thread', () => {
  it('an open topic: Mayor messages, ack, «новое», the waiting line', () => {
    setup('tp-aaaaaaaaaaaaaaaaaaaa');
    const p = pane();
    expect(within(p).getByRole('heading', { name: 'Перезагрузка общего CI в 22:00' })).toBeTruthy();
    expect(within(p).getByText(/открыл Мэр Ричарда · .* · люди видят и могут вмешаться/)).toBeTruthy();
    expect(within(p).getByText('Мэр Ричарда')).toBeTruthy();
    expect(within(p).getByText('Мой Мэр')).toBeTruthy();
    expect(within(p).getAllByText('агент')).toHaveLength(2);
    expect(within(p).getByText('✓ принято')).toBeTruthy();
    expect(within(p).getByText('новое')).toBeTruthy();
    expect(within(p).getByText(`ждёт ответа от Мэра Ричарда с ${asOfClock('2026-11-15T18:40:00Z')}`)).toBeTruthy();
    expect(collectMissing()).toEqual([]);
  });

  it('«Вмешаться…» posts a message (POST /v1/topics/message)', async () => {
    setup('tp-aaaaaaaaaaaaaaaaaaaa');
    const box = within(pane()).getByRole('textbox', { name: 'Сообщение в обсуждение' }) as HTMLTextAreaElement;
    expect(box.placeholder).toBe('Вмешаться: написать в обсуждение…');
    fireEvent.change(box, { target: { value: 'Да, перезагружайте' } });
    await act(async () => {
      fireEvent.click(within(pane()).getByRole('button', { name: 'Отправить' }));
    });
    expect(writes.action).toHaveBeenCalledWith(OPEN, { action: 'message', text: 'Да, перезагружайте' });
  });

  // Review I-2 / N-2: a ticket from a topic starts only from the owner's
  // button on the Mayor's Discord message (BOARD-LIVE L11); the dashboard
  // never hands the peer's title or text to our Mayor. Owner 16.11: no
  // answer buttons here either; the question links to Discord, and every
  // click in the thread posts nothing to Discord or the Mayor.
  it('no «Сделать задачей» here; the question only links to Discord and clicks post nothing', async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const open = vi.fn();
    vi.stubGlobal('open', open);
    // without a question: no «Сделать задачей» at all
    setup('tp-aaaaaaaaaaaaaaaaaaaa');
    expect(within(pane()).queryByRole('button', { name: /Сделать задачей/ })).toBeNull();
    expect(within(pane()).queryByRole('link', { name: /Сделать задачей/ })).toBeNull();
    cleanup();
    // with the owner's question on the topic: click every button inside it
    const topics = peerTopics();
    (topics[0] as Record<string, unknown>).owner_question = ownerQuestion();
    const result = parsePeerBoards(peerBody({ topics }));
    render(
      <MemoryRouter>
        <TopicsPanel
          open
          onClose={vi.fn()}
          peer={peerSourcesOf(result, NOW)[0]!}
          topics={result.peers[0]!.topics}
          selectedTopicId="tp-aaaaaaaaaaaaaaaaaaaa"
          onSelectTopic={vi.fn()}
          nowMs={NOW}
          ownLogin="me"
        />
      </MemoryRouter>,
    );
    const question = within(pane()).getByTestId('topic-question');
    expect(within(question).queryAllByRole('button')).toHaveLength(0);
    await act(async () => {
      fireEvent.click(within(question).getByRole('link', { name: 'Ответить в Discord' }));
    });
    expect(open).toHaveBeenCalledWith(QUESTION_JUMP, '_blank', 'noopener,noreferrer');
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('needs_human resolve 202 shows owner-question line with jump link and no optimistic state', async () => {
    writes.action.mockResolvedValue({ pending: { questionId: 'q-9', jumpUrl: QUESTION_JUMP } });
    setup('tp-bbbbbbbbbbbbbbbbbbbb');
    await act(async () => {
      fireEvent.click(within(pane()).getByRole('button', { name: 'Решено ✓' }));
    });
    fireEvent.change(within(pane()).getByRole('textbox', { name: 'Итог в одну строку' }), {
      target: { value: 'обновляю я' },
    });
    await act(async () => {
      fireEvent.click(within(pane()).getByRole('button', { name: 'Закрыть обсуждение' }));
    });
    const line = within(pane()).getByTestId('owner-question-pending');
    expect(line.textContent).toContain('Ждёт твоего ответа в Discord');
    expect(within(line).getByRole('link').getAttribute('href')).toBe(QUESTION_JUMP);
    // nothing pretends it is resolved: the banner stays, the topic is not closed
    expect(within(pane()).queryByTestId('topic-resolved')).toBeNull();
    expect(within(pane()).getByText('Мэры не договорились — нужен человек')).toBeTruthy();
    expect(within(pane()).getByRole('button', { name: 'Решено ✓' })).toBeTruthy();
    expect(collectMissing()).toEqual([]);
  });

  it('a linked ticket on our own topic shows as «→ задача dw-x1», opening that card on our board', () => {
    const topics = peerTopics();
    (topics[1] as Record<string, unknown>).ticket = 'dw-x1';
    const result = parsePeerBoards(peerBody({ topics }));
    render(
      <MemoryRouter>
        <TopicsPanel
          open
          onClose={vi.fn()}
          peer={peerSourcesOf(result, NOW)[0]!}
          topics={result.peers[0]!.topics}
          selectedTopicId="tp-bbbbbbbbbbbbbbbbbbbb"
          onSelectTopic={vi.fn()}
          nowMs={NOW}
          ownLogin="me"
        />
      </MemoryRouter>,
    );
    const link = within(pane()).getByRole('link', { name: '→ задача dw-x1' });
    expect(link.getAttribute('href')).toBe('/beads?bead=dw-x1');
    expect(collectMissing()).toEqual([]);
  });

  // Review M-7: the read stamp must not depend on a re-render. A message
  // the person actually sees is stamped once.
  it('an unread message that comes into view is stamped read once', async () => {
    const observed: Element[] = [];
    let fire: (els: Element[]) => void = () => undefined;
    class FakeIO {
      constructor(cb: (entries: { isIntersecting: boolean; target: Element }[]) => void) {
        fire = (els) => cb(els.map((target) => ({ isIntersecting: true, target })));
      }
      observe(el: Element) {
        observed.push(el);
      }
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeIO);
    setup('tp-aaaaaaaaaaaaaaaaaaaa');
    expect(observed.map((el) => (el as HTMLElement).dataset.commentId)).toEqual(['m-1']);
    await act(async () => {
      fire(observed);
    });
    expect(writes.read).toHaveBeenCalledTimes(1);
    expect(writes.read).toHaveBeenCalledWith(OPEN, '2026-11-15T18:35:00Z');
    vi.unstubAllGlobals();
  });

  it('«Решено» shows one check and asks for the outcome; people have no «Пауза» (contract c664ac8f)', async () => {
    setup('tp-aaaaaaaaaaaaaaaaaaaa');
    const resolve = within(pane()).getByRole('button', { name: 'Решено ✓' });
    expect(resolve.textContent).toBe('Решено ✓');
    expect(within(pane()).queryByRole('button', { name: 'Пауза' })).toBeNull();
    fireEvent.click(resolve);
    const summary = within(pane()).getByRole('textbox', { name: 'Итог в одну строку' });
    fireEvent.change(summary, { target: { value: 'перезагружаем в 22:00' } });
    await act(async () => {
      fireEvent.click(within(pane()).getByRole('button', { name: 'Закрыть обсуждение' }));
    });
    expect(writes.action).toHaveBeenCalledWith(OPEN, {
      action: 'resolve',
      reason: 'resolved',
      summary: 'перезагружаем в 22:00',
    });
    expect(collectMissing()).toEqual([]);
  });

  it('paused by a person: «На паузе» with «Продолжить», no «нужен человек»', async () => {
    setup('tp-dddddddddddddddddddd');
    const p = pane();
    expect(within(p).getByText('Обсуждение на паузе')).toBeTruthy();
    expect(within(p).queryByText('Мэры не договорились — нужен человек')).toBeNull();
    expect(within(p).queryByRole('button', { name: 'Пауза' })).toBeNull();
    await act(async () => {
      fireEvent.click(within(p).getByRole('button', { name: 'Продолжить' }));
    });
    expect(writes.action).toHaveBeenCalledWith(
      { city: 'me', topicId: 'tp-dddddddddddddddddddd' },
      { action: 'continue' },
    );
  });

  it('a resolved topic: the reason, its summary, a link to the deciding message, muted and readable', () => {
    setup('tp-cccccccccccccccccccc');
    const banner = within(pane()).getByTestId('topic-resolved');
    expect(banner.textContent).toContain('Решено');
    expect(banner.textContent).toContain('новое сообщение откроет снова');
    expect(banner.textContent).toContain('договорились, решено без задачи');
    expect(within(banner).getByRole('link', { name: 'к решению' }).getAttribute('href')).toBe('#comment-c-2');
    expect(within(pane()).getByText('Мой, оставляем.')).toBeTruthy();
    expect(within(pane()).queryByRole('button', { name: /Решено/ })).toBeNull();
  });

  it('a paused-by-the-rails topic shows the yellow banner in the thread too', () => {
    setup('tp-bbbbbbbbbbbbbbbbbbbb');
    expect(within(pane()).getByText('Мэры не договорились — нужен человек')).toBeTruthy();
  });

  it('the phone gets «К списку обсуждений» back', () => {
    const { onSelect } = setup('tp-aaaaaaaaaaaaaaaaaaaa');
    fireEvent.click(screen.getByRole('button', { name: 'К списку обсуждений' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('our login unknown to the city service: our own topic is read-only, his stays writable', () => {
    setup('tp-bbbbbbbbbbbbbbbbbbbb', vi.fn(), null);
    expect(within(pane()).queryByRole('textbox')).toBeNull();
    cleanup();
    setup('tp-aaaaaaaaaaaaaaaaaaaa', vi.fn(), null);
    expect(within(pane()).getByRole('textbox', { name: 'Сообщение в обсуждение' })).toBeTruthy();
  });

  it('a reader watches: no composer, no actions', () => {
    role.write = false;
    setup('tp-aaaaaaaaaaaaaaaaaaaa');
    expect(within(pane()).queryByRole('textbox')).toBeNull();
    expect(within(pane()).queryByRole('button', { name: /Решено/ })).toBeNull();
    expect(within(pane()).queryByRole('button', { name: 'Пауза' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Новое обсуждение/ })).toBeNull();
  });
});
