import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectMissing, resetMissing, setLocale } from '../../i18n';
import { parsePeerBoards, type PeerComment } from '../../supervisor/peerBoardReads';
import {
  AVATAR_BASE,
  DEPUTY_DISCORD,
  peerBody,
  peerThread,
  RICHARD_DISCORD,
  RICH_MAYOR_DISCORD,
} from '../../test/fixtures/peerBoards';
import { CommentComposer, CommentList } from './CommentThread';

// vk-final part 4: the vibe-kanban comment look (IssueCommentsSection
// CommentItem) with our author kinds and side colours (coordinator 15.11).

function comments(): readonly PeerComment[] {
  return parsePeerBoards(peerBody({ threads: [peerThread()] })).peers[0]!.threads[0]!.comments;
}

beforeEach(() => {
  setLocale('ru');
  resetMissing();
});
afterEach(() => {
  cleanup();
  setLocale('en');
});

function renderList(extra: Partial<Parameters<typeof CommentList>[0]> = {}) {
  return render(
    <CommentList comments={comments()} peerLabel="Ричарда" myLabel="Артёма" nowMs={Date.parse('2026-11-15T20:00:00Z')} {...extra} />,
  );
}

const items = () => screen.getAllByTestId('comment');

describe('CommentList', () => {
  it('a Mayor shows the Mayor glyph, «Мэр Ричарда» and the «агент» chip', () => {
    renderList();
    const mayor = items()[0]!;
    expect(within(mayor).getByText('Мэр Ричарда')).toBeTruthy();
    expect(within(mayor).getByText('агент')).toBeTruthy();
    expect(within(mayor).getByTestId('glyph-mayor')).toBeTruthy();
    expect(mayor.getAttribute('data-side')).toBe('peer');
  });

  it('another agent shows the robot glyph, its name and «агент»', () => {
    renderList();
    const agent = items().find((el) => within(el).queryByText('deputy') !== null)!;
    expect(within(agent).getByTestId('glyph-agent')).toBeTruthy();
    expect(within(agent).getByText('агент')).toBeTruthy();
  });

  it('people get an initials avatar; my side is «mine», his is «peer»', () => {
    renderList();
    const mine = items()[1]!;
    expect(mine.getAttribute('data-side')).toBe('mine');
    expect(within(mine).getByTestId('avatar-initials').textContent).toBe('А');
  });

  it('delivery state shows only on my own comments', () => {
    renderList();
    const mineDelivered = items()[1]!;
    expect(within(mineDelivered).getByText('доставлено')).toBeTruthy();
    const queued = items().at(-1)!;
    expect(within(queued).getByText('ждёт доставки')).toBeTruthy();
    const richard = items()[2]!;
    expect(within(richard).queryByText(/доставлено|ждёт/)).toBeNull();
  });

  it('consecutive comments from one author are grouped under one header', () => {
    renderList();
    const richardHeaders = screen.getAllByText('Ричард');
    expect(richardHeaders).toHaveLength(1);
    // both of his texts are there
    expect(screen.getByText('Ок, подожду')).toBeTruthy();
    expect(screen.getByText('напиши, как вольёшь')).toBeTruthy();
  });

  it('an ack is a small «✓ принято» on the message, not a message', () => {
    renderList({ acks: new Set(['bd-1']) });
    expect(within(items()[0]!).getByText('✓ принято')).toBeTruthy();
    expect(collectMissing()).toEqual([]);
  });
});

describe('Discord identity (owner 15.11)', () => {
  function withIdentity(): readonly PeerComment[] {
    const thread = peerThread();
    thread.comments[0]!.author = RICH_MAYOR_DISCORD;
    thread.comments[2]!.author = RICHARD_DISCORD as never;
    thread.comments[4]!.author = DEPUTY_DISCORD as never;
    return parsePeerBoards(peerBody({ threads: [thread] })).peers[0]!.threads[0]!.comments;
  }

  it('the avatar image, the display name, and the role caption', () => {
    renderList({ comments: withIdentity() });
    const mayor = items()[0]!;
    const img = within(mayor).getByTestId('avatar-image') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(`${AVATAR_BASE}/111111111111111111.png`);
    expect(within(mayor).getByText('Richard’s Mayor')).toBeTruthy();
    expect(within(mayor).getByText('Мэр Ричарда')).toBeTruthy();
    // the side colour stays
    expect(mayor.getAttribute('data-side')).toBe('peer');
    const richard = items()[2]!;
    expect(within(richard).getByText('richard.dev')).toBeTruthy();
    expect(within(richard).getByText('Ричард')).toBeTruthy();
    const deputy = items().find((el) => within(el).queryByText('Deputy') !== null)!;
    expect(within(deputy).getByText('агент · deputy')).toBeTruthy();
    expect(collectMissing()).toEqual([]);
  });

  it('a broken avatar falls back to the glyph or initials', () => {
    renderList({ comments: withIdentity() });
    const mayor = items()[0]!;
    fireEvent.error(within(mayor).getByTestId('avatar-image'));
    expect(within(mayor).queryByTestId('avatar-image')).toBeNull();
    expect(within(mayor).getByTestId('glyph-mayor')).toBeTruthy();
  });

  // BOARD-LIVE L5/L7: the city's role caption («Мэр Артёма» = «Мэр » +
  // genitive, from OUR people.json; a person's caption is the name).
  it('role caption renders under display name; avatar only from AVATAR_PATH_RE', () => {
    const thread = peerThread();
    thread.comments[0]!.author = { ...RICH_MAYOR_DISCORD, role_caption: 'Мэр Ричарда (город)' } as never;
    thread.comments[2]!.author = { ...RICHARD_DISCORD, role_caption: 'Ричард' } as never;
    // a person whose Discord name IS the caption: the name shows once
    thread.comments[1]!.author = { kind: 'person', city: 'me', name: 'Артём', display_name: 'Артём', role_caption: 'Артём' } as never;
    // an avatar on another origin is dropped
    thread.comments[4]!.author = { ...DEPUTY_DISCORD, avatar_url: 'https://cdn.discordapp.com/avatars/1/x.png' } as never;
    renderList({ comments: parsePeerBoards(peerBody({ threads: [thread] })).peers[0]!.threads[0]!.comments });
    const mayor = items()[0]!;
    const name = within(mayor).getByText('Richard’s Mayor');
    const caption = within(mayor).getByText('Мэр Ричарда (город)');
    expect(caption.getAttribute('data-testid')).toBe('role-caption');
    // under: the name and the caption share one column, caption after the name
    expect(name.parentElement).toBe(caption.parentElement);
    expect(name.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(name.parentElement?.className).toContain('flex-col');
    const richard = items()[2]!;
    expect(within(richard).getByText('richard.dev')).toBeTruthy();
    expect(within(richard).getByTestId('role-caption').textContent).toBe('Ричард');
    const me = items()[1]!;
    expect(within(me).getAllByText('Артём')).toHaveLength(1);
    expect(within(me).queryByTestId('role-caption')).toBeNull();
    const deputy = items().find((el) => within(el).queryByText('Deputy') !== null)!;
    expect(within(deputy).queryByTestId('avatar-image')).toBeNull();
    expect(collectMissing()).toEqual([]);
  });

  it('own queued message with undelivered peer_offline shows «не доставлено: Ричард не в сети»', () => {
    const thread = peerThread();
    (thread.comments[5] as Record<string, unknown>).undelivered = 'peer_offline';
    renderList({ comments: parsePeerBoards(peerBody({ threads: [thread] })).peers[0]!.threads[0]!.comments, peerName: 'Ричард' });
    const queued = items().at(-1)!;
    expect(within(queued).getByText('не доставлено: Ричард не в сети')).toBeTruthy();
    expect(within(queued).queryByText('ждёт доставки')).toBeNull();
    // a delivered one of mine is unaffected
    expect(within(items()[1]!).getByText('доставлено')).toBeTruthy();
    expect(collectMissing()).toEqual([]);
  });

  it('no identity: today’s rendering (glyph or initials, role as the name)', () => {
    renderList();
    expect(within(items()[0]!).queryByTestId('avatar-image')).toBeNull();
    expect(within(items()[0]!).getByText('Мэр Ричарда')).toBeTruthy();
  });
});

describe('CommentComposer', () => {
  // BOARD-CHAT C1 (owner 19.11, point 5): the box never waits for the server.
  function deferred() {
    let resolve!: () => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('clears input in the same frame as Enter', () => {
    const pending = deferred();
    const onSubmit = vi.fn().mockReturnValue(pending.promise);
    render(<CommentComposer label="Комментарий" placeholder="…" onSubmit={onSubmit} />);
    const box = screen.getByRole('textbox', { name: 'Комментарий' }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'вопрос' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    // synchronously, while the send promise is still pending
    expect(onSubmit).toHaveBeenCalledWith('вопрос');
    expect(box.value).toBe('');
  });

  it('shows a pending row before the server answers', async () => {
    const pending = deferred();
    const onSubmit = vi.fn().mockReturnValue(pending.promise);
    render(<CommentComposer label="Комментарий" placeholder="…" onSubmit={onSubmit} />);
    const box = screen.getByRole('textbox', { name: 'Комментарий' }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'вопрос' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    const row = screen.getByTestId('outgoing-row');
    expect(row.getAttribute('data-state')).toBe('sending');
    expect(within(row).getByText('вопрос')).toBeTruthy();
    expect(within(row).getByText('отправляется')).toBeTruthy();
    // a second message can go while the first is still on its way
    fireEvent.change(box, { target: { value: 'уточнение' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(screen.getAllByTestId('outgoing-row')).toHaveLength(2);
    await act(async () => {
      pending.resolve();
    });
    // once sent, the thread's own row takes over
    expect(screen.queryAllByTestId('outgoing-row')).toHaveLength(0);
    expect(collectMissing()).toEqual([]);
  });

  it('failed send keeps the row with повторить', async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(undefined);
    render(<CommentComposer label="Комментарий" placeholder="…" onSubmit={onSubmit} />);
    const box = screen.getByRole('textbox', { name: 'Комментарий' }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'вопрос' } });
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' });
    });
    const row = screen.getByTestId('outgoing-row');
    expect(row.getAttribute('data-state')).toBe('failed');
    expect(within(row).getByText('вопрос')).toBeTruthy();
    expect(within(row).getByText('не доставлено')).toBeTruthy();
    expect(box.value).toBe('');
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'повторить' }));
    });
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenLastCalledWith('вопрос');
    expect(screen.queryAllByTestId('outgoing-row')).toHaveLength(0);
    expect(collectMissing()).toEqual([]);
  });

  it('sends with the button or Ctrl+Enter, clears, and keeps a failed row on failure', async () => {
    const onSubmit = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('x'));
    render(
      <CommentComposer
        label="Комментарий для Ричарда"
        placeholder="Написать Ричарду…"
        hint="уйдёт в город Ричарда за ~минуту; его Мэр покажет ему"
        onSubmit={onSubmit}
      />,
    );
    const box = screen.getByRole('textbox', { name: 'Комментарий для Ричарда' }) as HTMLTextAreaElement;
    expect(box.placeholder).toBe('Написать Ричарду…');
    const send = screen.getByRole('button', { name: 'Отправить' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(box, { target: { value: 'привет' } });
    await act(async () => {
      fireEvent.click(send);
    });
    expect(onSubmit).toHaveBeenCalledWith('привет');
    expect(box.value).toBe('');
    fireEvent.change(box, { target: { value: 'ещё' } });
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    });
    expect(onSubmit).toHaveBeenCalledWith('ещё');
    expect(screen.getByRole('alert').textContent).toBe('Не отправлено — попробуй ещё раз.');
    expect(box.value).toBe('');
    expect(screen.getByTestId('outgoing-row').getAttribute('data-state')).toBe('failed');
    expect(collectMissing()).toEqual([]);
  });

  it('Shift+Enter inserts a newline; IME composition does not send', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CommentComposer label="Комментарий" placeholder="…" onSubmit={onSubmit} />);
    const box = screen.getByRole('textbox', { name: 'Комментарий' }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'строка' } });
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    });
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    });
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' });
    });
    expect(onSubmit).toHaveBeenCalledWith('строка');
    expect(box.value).toBe('');
  });
});
