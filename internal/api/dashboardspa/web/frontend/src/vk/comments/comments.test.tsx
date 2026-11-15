import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectMissing, resetMissing, setLocale } from '../../i18n';
import { parsePeerBoards, type PeerComment } from '../../supervisor/peerBoardReads';
import { peerBody, peerThread } from '../../test/fixtures/peerBoards';
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

describe('CommentComposer', () => {
  it('sends with the button or Ctrl+Enter, clears, and shows an error on failure', async () => {
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
    expect(box.value).toBe('ещё');
    expect(collectMissing()).toEqual([]);
  });
});
