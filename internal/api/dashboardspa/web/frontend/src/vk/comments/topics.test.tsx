import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectMissing, resetMissing, setLocale } from '../../i18n';
import { asOfClock, peerSourcesOf } from '../../lib/boardOwner';
import { parsePeerBoards } from '../../supervisor/peerBoardReads';
import { peerBody, peerTopics } from '../../test/fixtures/peerBoards';
import { TopicsPanel } from './TopicsPanel';
import type * as PeerCommentWrites from '../../supervisor/peerCommentWrites';
import type * as ActivitySession from '../../embed/activitySession';

// vk-final part 4: «Обсуждения Мэров» with the peer city (frames
// General-Thread, Phone-Topics; COMMENTS-PLAN Revision 2). The Mayors talk;
// people watch and can step in.

const writes = vi.hoisted(() => ({ topic: vi.fn(), read: vi.fn() }));
vi.mock('../../supervisor/peerCommentWrites', async (orig) => ({
  ...(await orig<typeof PeerCommentWrites>()),
  postTopicEvent: writes.topic,
  markTopicRead: writes.read,
}));
const role = vi.hoisted(() => ({ write: true }));
vi.mock('../../embed/activitySession', async (orig) => ({
  ...(await orig<typeof ActivitySession>()),
  canWrite: () => role.write,
}));

const NOW = Date.parse('2026-11-15T19:00:00Z');
function setup(selected: string | null = null, onSelect = vi.fn()) {
  const result = parsePeerBoards(peerBody({ topics: peerTopics() }));
  const peer = peerSourcesOf(result, NOW)[0]!;
  render(
    <MemoryRouter>
      <TopicsPanel
        open
        onClose={vi.fn()}
        peer={peer}
        topics={result.peers[0]!.topics}
        selectedTopicId={selected}
        onSelectTopic={onSelect}
        nowMs={NOW}
      />
    </MemoryRouter>,
  );
  return { onSelect };
}

beforeEach(() => {
  setLocale('ru');
  resetMissing();
  writes.topic.mockReset().mockResolvedValue(undefined);
  writes.read.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  setLocale('en');
  role.write = true;
});

const list = () => screen.getByRole('navigation', { name: 'Обсуждения' });

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
    const resolved = within(nav).getByRole('button', { name: /Решённые · 14 дней/ });
    expect(resolved.getAttribute('aria-expanded')).toBe('false');
    expect(within(nav).queryByText('Ключ Clerk')).toBeNull();
    fireEvent.click(resolved);
    expect(within(nav).getByText('Ключ Clerk')).toBeTruthy();
    expect(within(nav).getByText('→ договорились, решено без задачи')).toBeTruthy();
    expect(collectMissing()).toEqual([]);
  });

  it('a paused topic: «Мэры не договорились — нужен человек», «Продолжить», «Решить самому»', async () => {
    const { onSelect } = setup();
    const banner = within(list()).getByRole('status');
    expect(banner.textContent).toContain('Мэры не договорились — нужен человек');
    await act(async () => {
      fireEvent.click(within(banner).getByRole('button', { name: 'Продолжить' }));
    });
    expect(writes.topic).toHaveBeenCalledWith(
      { city: 'me', topicId: 'tp-bbbbbbbbbbbbbbbbbbbb' },
      { event: 'topic_continue' },
    );
    fireEvent.click(within(banner).getByRole('button', { name: 'Решить самому' }));
    expect(onSelect).toHaveBeenCalledWith('tp-bbbbbbbbbbbbbbbbbbbb');
  });

  it('«Новое обсуждение» opens a topic with the peer', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Новое обсуждение/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Тема' }), { target: { value: 'Общий CI' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Первое сообщение' }), { target: { value: 'Можно в 22:00?' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Открыть обсуждение' }));
    });
    expect(writes.topic).toHaveBeenCalledWith(
      { city: 'rich' },
      { event: 'topic_open', title: 'Общий CI', text: 'Можно в 22:00?' },
    );
  });
});

describe('TopicsPanel thread', () => {
  it('an open topic: Mayor messages, ack, «новое», the waiting line', () => {
    setup('tp-aaaaaaaaaaaaaaaaaaaa');
    const pane = screen.getByRole('region', { name: 'Обсуждение' });
    expect(within(pane).getByRole('heading', { name: 'Перезагрузка общего CI в 22:00' })).toBeTruthy();
    expect(within(pane).getByText(/открыл Мэр Ричарда · .* · люди видят и могут вмешаться/)).toBeTruthy();
    expect(within(pane).getByText('Мэр Ричарда')).toBeTruthy();
    expect(within(pane).getByText('Мой Мэр')).toBeTruthy();
    expect(within(pane).getAllByText('агент')).toHaveLength(2);
    expect(within(pane).getByText('✓ принято')).toBeTruthy();
    expect(within(pane).getByText('новое')).toBeTruthy();
    expect(
      within(pane).getByText(`ждёт ответа от Мэра Ричарда с ${asOfClock('2026-11-15T18:40:00Z')}`),
    ).toBeTruthy();
    expect(collectMissing()).toEqual([]);
  });

  it('«Вмешаться…» posts a message; «Решено ✓» resolves', async () => {
    setup('tp-aaaaaaaaaaaaaaaaaaaa');
    const pane = screen.getByRole('region', { name: 'Обсуждение' });
    const box = within(pane).getByRole('textbox', { name: 'Сообщение в обсуждение' }) as HTMLTextAreaElement;
    expect(box.placeholder).toBe('Вмешаться: написать в обсуждение…');
    fireEvent.change(box, { target: { value: 'Да, перезагружайте' } });
    await act(async () => {
      fireEvent.click(within(pane).getByRole('button', { name: 'Отправить' }));
    });
    expect(writes.topic).toHaveBeenCalledWith(
      { city: 'rich', topicId: 'tp-aaaaaaaaaaaaaaaaaaaa' },
      { event: 'topic_message', text: 'Да, перезагружайте' },
    );
    await act(async () => {
      fireEvent.click(within(pane).getByRole('button', { name: /Решено/ }));
    });
    expect(writes.topic).toHaveBeenCalledWith(
      { city: 'rich', topicId: 'tp-aaaaaaaaaaaaaaaaaaaa' },
      { event: 'topic_resolve', reason: 'resolved' },
    );
    expect(within(pane).getByRole('button', { name: 'Сделать задачей' })).toBeTruthy();
  });

  it('a resolved topic: the reason, its summary, a link to the deciding message, muted and readable', () => {
    setup('tp-cccccccccccccccccccc');
    const pane = screen.getByRole('region', { name: 'Обсуждение' });
    const banner = within(pane).getByTestId('topic-resolved');
    expect(banner.textContent).toContain('Решено');
    expect(banner.textContent).toContain('новое сообщение откроет снова');
    expect(banner.textContent).toContain('договорились, решено без задачи');
    expect(within(banner).getByRole('link', { name: 'к решению' }).getAttribute('href')).toBe('#comment-c-2');
    expect(within(pane).getByText('Мой, оставляем.')).toBeTruthy();
    expect(within(pane).queryByRole('button', { name: /Решено/ })).toBeNull();
  });

  it('a paused topic shows the yellow banner in the thread too', () => {
    setup('tp-bbbbbbbbbbbbbbbbbbbb');
    const pane = screen.getByRole('region', { name: 'Обсуждение' });
    expect(within(pane).getByText('Мэры не договорились — нужен человек')).toBeTruthy();
  });

  it('the phone gets «К списку обсуждений» back', () => {
    const { onSelect } = setup('tp-aaaaaaaaaaaaaaaaaaaa');
    fireEvent.click(screen.getByRole('button', { name: 'К списку обсуждений' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('a reader watches: no composer, no actions', () => {
    role.write = false;
    setup('tp-aaaaaaaaaaaaaaaaaaaa');
    const pane = screen.getByRole('region', { name: 'Обсуждение' });
    expect(within(pane).queryByRole('textbox')).toBeNull();
    expect(within(pane).queryByRole('button', { name: /Решено/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Новое обсуждение/ })).toBeNull();
  });
});
