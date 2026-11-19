import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadOnlyProvider } from '../../contexts/ReadOnlyContext';
import type { CardChat as CardChatState, ChatRow } from '../../hooks/useCardChat';
import { collectMissing, resetMissing, setLocale } from '../../i18n';

// BOARD-CHAT Task C4 (owner 19.11 points 2 and 6): the private card chat.

const chat = vi.hoisted(() => ({
  state: null as unknown as CardChatState,
  calls: [] as { city: string; card: { rig: string; id: string }; sessions?: unknown }[],
}));

vi.mock('../../hooks/useCardChat', () => ({
  useCardChat: (city: string, card: { rig: string; id: string }, sessions?: unknown) => {
    chat.calls.push(sessions === undefined ? { city, card } : { city, card, sessions });
    return chat.state;
  },
}));

import { CardChat } from './CardChat';

function state(over: Partial<CardChatState> = {}): CardChatState {
  return {
    rows: [],
    send: vi.fn(),
    retry: vi.fn(),
    answer: vi.fn(),
    status: 'ready',
    who: 'desk',
    agentActivity: 'idle',
    ...over,
  };
}

function row(over: Partial<ChatRow>): ChatRow {
  return { key: 'r1', who: 'owner', text: 'вопрос', at: '2026-11-19T15:00:00Z', ...over };
}

beforeEach(() => {
  setLocale('ru');
  resetMissing();
  chat.state = state();
  chat.calls = [];
});
afterEach(() => {
  cleanup();
  setLocale('en');
});

const CARD = { rig: 'dw', id: 'dw-1' };

describe('CardChat', () => {
  it('shows a skeleton while the card’s rig is unknown, and does not read', () => {
    render(<CardChat city="devwork" card={{ rig: null, id: 'dw-1' }} />);
    expect(screen.getByTestId('card-chat-skeleton')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(chat.calls).toHaveLength(0);
  });

  it('shows the same skeleton while the thread loads', () => {
    chat.state = state({ status: 'loading' });
    render(<CardChat city="devwork" card={CARD} />);
    expect(screen.getByTestId('card-chat-skeleton')).toBeTruthy();
    expect(chat.calls.at(-1)).toMatchObject({ city: 'devwork', card: CARD });
  });

  it('shows hint for own card', () => {
    render(<CardChat city="devwork" card={CARD} />);
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(box.placeholder).toBe('Спросить про эту карточку…');
    expect(screen.getByText('видите только вы и ваш Мэр')).toBeTruthy();
    expect(collectMissing()).toEqual([]);
  });

  it('shows the rows with plain names and states', () => {
    chat.state = state({
      rows: [
        row({ key: 'a', text: 'первый', state: 'delivered' }),
        row({ key: 'b', who: 'desk', text: 'ответ' }),
        row({ key: 'c', who: 'mayor', text: 'сделал' }),
        row({ key: 'd', text: 'летит', state: 'sending' }),
        row({ key: 'e', text: 'в очереди', state: 'queued' }),
        row({ key: 'f', text: 'упал', state: 'failed', retryable: true }),
      ],
    });
    render(<CardChat city="devwork" card={CARD} />);
    const rows = screen.getAllByTestId('chat-row');
    expect(within(rows[0]!).getByText('Вы')).toBeTruthy();
    expect(within(rows[0]!).getByText('доставлено')).toBeTruthy();
    expect(within(rows[1]!).getByText('Дежурный')).toBeTruthy();
    expect(within(rows[2]!).getByText('Мэр')).toBeTruthy();
    expect(within(rows[3]!).getByText('отправляется')).toBeTruthy();
    expect(within(rows[4]!).getByText('отправляется')).toBeTruthy();
    expect(within(rows[5]!).getByText('не доставлено')).toBeTruthy();
    fireEvent.click(within(rows[5]!).getByRole('button', { name: 'повторить' }));
    expect(chat.state.retry).toHaveBeenCalledWith('f');
    expect(collectMissing()).toEqual([]);
  });

  it('reading and agent states', () => {
    chat.state = state({ rows: [row({ state: 'reading' })], agentActivity: 'in-turn' });
    const { unmount } = render(<CardChat city="devwork" card={CARD} />);
    expect(screen.getByText('Дежурный читает…')).toBeTruthy();
    unmount();
    chat.state = state({ rows: [row({ state: 'delivered' }), row({ key: 'r2', who: 'desk', text: 'ответ' })], agentActivity: 'in-turn' });
    const second = render(<CardChat city="devwork" card={CARD} />);
    expect(screen.getByText('Дежурный отвечает на другой вопрос')).toBeTruthy();
    second.unmount();
    chat.state = state({ rows: [row({ state: 'delivered' })], who: 'mayor', agentActivity: 'in-turn' });
    render(<CardChat city="devwork" card={CARD} />);
    expect(screen.getByText('Мэр работает — ответит здесь')).toBeTruthy();
    expect(collectMissing()).toEqual([]);
  });

  it('renders ask buttons only for an unanswered ask', () => {
    chat.state = state({
      rows: [
        row({ key: 'e1', who: 'mayor', text: 'Закрыть?', ask: { entryId: 'e1', answered: true } }),
        row({ key: 'e2', who: 'mayor', text: 'А эту?', ask: { entryId: 'e2', answered: false } }),
      ],
    });
    render(<CardChat city="devwork" card={CARD} />);
    const rows = screen.getAllByTestId('chat-row');
    expect(within(rows[0]!).queryByRole('button', { name: 'Да' })).toBeNull();
    fireEvent.click(within(rows[1]!).getByRole('button', { name: 'Да' }));
    expect(chat.state.answer).toHaveBeenCalledWith('e2', true);
    fireEvent.click(within(rows[1]!).getByRole('button', { name: 'Нет' }));
    expect(chat.state.answer).toHaveBeenCalledWith('e2', false);
  });

  it('Enter sends, Shift+Enter newline', () => {
    render(<CardChat city="devwork" card={CARD} />);
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'строка' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    expect(chat.state.send).not.toHaveBeenCalled();
    act(() => {
      fireEvent.keyDown(box, { key: 'Enter' });
    });
    expect(chat.state.send).toHaveBeenCalledWith('строка');
    // cleared in the same frame
    expect(box.value).toBe('');
    // an empty box sends nothing
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(chat.state.send).toHaveBeenCalledTimes(1);
  });

  it('read-only: the thread shows, the box does not', () => {
    chat.state = state({ rows: [row({ state: 'delivered' })] });
    render(
      <ReadOnlyProvider readOnly>
        <CardChat city="devwork" card={CARD} />
      </ReadOnlyProvider>,
    );
    expect(screen.getAllByTestId('chat-row')).toHaveLength(1);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('phone width 390 px: input stays visible above the keyboard area', () => {
    const before = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    try {
      chat.state = state({ rows: Array.from({ length: 30 }, (_, i) => row({ key: `k${i}`, text: `строка ${i}` })) });
      render(<CardChat city="devwork" card={CARD} />);
      const root = screen.getByTestId('card-chat');
      const thread = screen.getByTestId('card-chat-thread');
      const input = screen.getByTestId('card-chat-input');
      // the thread scrolls inside a dynamic-viewport cap; the input follows it, never inside it
      expect(thread.className).toContain('overflow-y-auto');
      expect(thread.className).toContain('max-h-[35dvh]');
      expect(thread.contains(input)).toBe(false);
      expect(root.lastElementChild).toBe(input);
      expect(input.className).toContain('flex-none');
      // 16 px text: iOS does not zoom the page on focus
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).className).toContain('text-base');
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: before });
    }
  });

  it('passes the board’s sessions on, so replies are told apart by their source (review I6)', () => {
    const sessions = [{ id: 's-mayor', template: 'mayor' }];
    render(<CardChat city="devwork" card={CARD} sessions={sessions} />);
    expect(chat.calls.at(-1)).toEqual({ city: 'devwork', card: CARD, sessions });
  });

  it('review Q3: a card with no chat shows one plain line, never a skeleton or a box', () => {
    const { unmount } = render(<CardChat city="devwork" card={{ rig: null, id: 'gcg-1' }} noChat />);
    expect(screen.getByText('Чат есть у задач и эпиков продукта')).toBeTruthy();
    expect(screen.queryByTestId('card-chat-skeleton')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(chat.calls).toHaveLength(0);
    unmount();
    // the service said so (409 not_own_card)
    chat.state = state({ status: 'no_chat' });
    render(<CardChat city="devwork" card={CARD} />);
    expect(screen.getByText('Чат есть у задач и эпиков продукта')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(collectMissing()).toEqual([]);
  });

  it('re-review R1: in the no-chat state the refused words stay on screen, with why and «повторить»', () => {
    chat.state = state({
      status: 'no_chat',
      rows: [
        row({ key: 'old', who: 'desk', text: 'давний ответ' }),
        row({ key: 'c-1', text: 'что это за карточка?', state: 'failed', error: 'not_own_card', retryable: true }),
      ],
    });
    render(<CardChat city="devwork" card={CARD} />);
    expect(screen.getByText('Чат есть у задач и эпиков продукта')).toBeTruthy();
    const kept = screen.getByTestId('chat-row');
    expect(within(kept).getByText('что это за карточка?')).toBeTruthy();
    expect(within(kept).getByText('не доставлено: чат есть только у задач и эпиков продукта')).toBeTruthy();
    fireEvent.click(within(kept).getByRole('button', { name: 'повторить' }));
    expect(chat.state.retry).toHaveBeenCalledWith('c-1');
    expect(screen.queryByText('давний ответ')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(collectMissing()).toEqual([]);
  });

  it('review M1: a refusal says why; «повторить» only where it can help', () => {
    chat.state = state({
      rows: [
        row({ key: 'a', text: 'длинно', state: 'failed', error: 'too_long', retryable: false }),
        row({ key: 'b', text: 'чужое', state: 'failed', error: 'not_owner', retryable: false }),
        row({ key: 'c', text: 'сеть', state: 'failed', error: 'unavailable', retryable: true }),
      ],
    });
    render(<CardChat city="devwork" card={CARD} />);
    const rows = screen.getAllByTestId('chat-row');
    expect(within(rows[0]!).getByText('не доставлено: длиннее 4000 знаков')).toBeTruthy();
    expect(within(rows[0]!).queryByRole('button', { name: 'повторить' })).toBeNull();
    expect(within(rows[1]!).getByText('не доставлено: писать сюда может только хозяин доски')).toBeTruthy();
    expect(within(rows[2]!).getByText('не доставлено: чат сейчас недоступен')).toBeTruthy();
    expect(within(rows[2]!).getByRole('button', { name: 'повторить' })).toBeTruthy();
    expect(collectMissing()).toEqual([]);
  });

  it('review M1: the box holds at most 4000 characters and shows the count', () => {
    render(<CardChat city="devwork" card={CARD} />);
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(box.maxLength).toBe(4000);
    expect(screen.queryByText(/из 4000 знаков/)).toBeNull();
    fireEvent.change(box, { target: { value: 'привет' } });
    expect(screen.getByText('6 из 4000 знаков')).toBeTruthy();
    expect(collectMissing()).toEqual([]);
  });

  describe('review I4: the thread shows its newest rows', () => {
    const heights = { scroll: 1000, client: 200 };
    let restore: () => void;
    beforeEach(() => {
      const sh = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
      const ch = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => heights.scroll });
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => heights.client });
      restore = () => {
        if (sh) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', sh);
        if (ch) Object.defineProperty(HTMLElement.prototype, 'clientHeight', ch);
      };
    });
    afterEach(() => restore());

    it('on open, and on a new row while the owner is at the bottom; not when he scrolled up', () => {
      chat.state = state({ rows: [row({ key: 'a', text: 'один' })] });
      const { rerender } = render(<CardChat city="devwork" card={CARD} />);
      const thread = screen.getByTestId('card-chat-thread');
      expect(thread.scrollTop).toBe(1000);
      // a new row while at the bottom
      heights.scroll = 1400;
      chat.state = state({ rows: [row({ key: 'a', text: 'один' }), row({ key: 'b', who: 'desk', text: 'два' })] });
      rerender(<CardChat city="devwork" card={CARD} />);
      expect(thread.scrollTop).toBe(1400);
      // the owner scrolls up to read; a new row does not pull him down
      thread.scrollTop = 100;
      fireEvent.scroll(thread);
      heights.scroll = 1800;
      chat.state = state({ rows: [...chat.state.rows, row({ key: 'c', who: 'desk', text: 'три' })] });
      rerender(<CardChat city="devwork" card={CARD} />);
      expect(thread.scrollTop).toBe(100);
    });
  });

  it('layout at 2000 px uses the drawer width', () => {
    const before = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 2000 });
    try {
      render(<CardChat city="devwork" card={CARD} />);
      const root = screen.getByTestId('card-chat');
      expect(root.className).toContain('w-full');
      expect(root.className).not.toMatch(/(^|\s)max-w-/);
      expect(screen.getByTestId('card-chat-thread').className).toContain('md:max-h-[45dvh]');
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: before });
    }
  });
});
