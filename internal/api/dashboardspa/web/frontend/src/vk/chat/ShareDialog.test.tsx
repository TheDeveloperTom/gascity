import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardChat as CardChatState, ChatRow } from '../../hooks/useCardChat';
import { collectMissing, resetMissing, setLocale } from '../../i18n';

// BOARD-CHAT Task C5 (owner 19.11 point 4, DOCCHECK DC#32): Richard sees an
// own card only when the owner presses «Показать Ричарду» and sends a short
// summary he has seen and may edit.

const share = vi.hoisted(() => ({ shareCard: vi.fn() }));
vi.mock('../../supervisor/boardChat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../supervisor/boardChat')>();
  return { ...actual, shareCard: share.shareCard };
});

const chat = vi.hoisted(() => ({ state: null as unknown as CardChatState }));
vi.mock('../../hooks/useCardChat', () => ({ useCardChat: () => chat.state }));

import { CardChat } from './CardChat';
import { SHARE_SUMMARY_MAX, ShareDialog, sharePrefill } from './ShareDialog';

function row(over: Partial<ChatRow>): ChatRow {
  return { key: 'r', who: 'owner', text: '', at: '2026-11-19T15:00:00Z', ...over };
}

const PEER = { name: 'Ричард', dative: 'Ричарду' };
const CARD = { rig: 'dw', id: 'dw-1' };

beforeEach(() => {
  setLocale('ru');
  resetMissing();
  share.shareCard.mockReset().mockResolvedValue({ topic: 'devwork/t-1' });
  chat.state = {
    rows: [
      row({ key: 'a', text: 'что это?' }),
      row({ key: 'b', who: 'desk', text: 'Это вход по ссылке.' }),
      row({ key: 'c', text: 'долго ещё?' }),
      row({ key: 'd', who: 'desk', text: 'Минут десять.' }),
    ],
    send: vi.fn(),
    retry: vi.fn(),
    answer: vi.fn(),
    status: 'ready',
    who: 'desk',
    agentActivity: 'idle',
  };
});
afterEach(() => {
  cleanup();
  setLocale('en');
});

describe('ShareDialog', () => {
  it('prefill is title + last owner question + last answer, ≤600 chars', () => {
    expect(sharePrefill('Вход по ссылке', chat.state.rows)).toBe('Вход по ссылке\nдолго ещё?\nМинут десять.');
    expect(sharePrefill('Карточка', [])).toBe('Карточка');
    const long = sharePrefill('Т'.repeat(300), [row({ text: 'в'.repeat(400) }), row({ who: 'mayor', text: 'о'.repeat(400) })]);
    expect(long.length).toBeLessThanOrEqual(SHARE_SUMMARY_MAX);
    expect(SHARE_SUMMARY_MAX).toBe(600);
  });

  it('send is disabled until the owner has seen the text (focus or edit)', () => {
    render(<ShareDialog open onClose={() => {}} city="devwork" card={CARD} title="Вход по ссылке" rows={chat.state.rows} peer={PEER} onShared={() => {}} />);
    const send = screen.getByRole('button', { name: 'Показать Ричарду' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.focus(screen.getByRole('textbox', { name: 'Что увидит Ричард' }));
    expect(send.disabled).toBe(false);
    expect(collectMissing()).toEqual([]);
  });

  it('send calls shareCard with exactly the edited text', async () => {
    const onShared = vi.fn();
    render(<ShareDialog open onClose={() => {}} city="devwork" card={CARD} title="Вход по ссылке" rows={chat.state.rows} peer={PEER} onShared={onShared} />);
    const box = screen.getByRole('textbox', { name: 'Что увидит Ричард' }) as HTMLTextAreaElement;
    expect(box.value).toBe('Вход по ссылке\nдолго ещё?\nМинут десять.');
    fireEvent.change(box, { target: { value: '  Глянь вход, там ссылка ломается  ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Показать Ричарду' }));
    });
    expect(share.shareCard).toHaveBeenCalledWith('devwork', CARD, 'Глянь вход, там ссылка ломается');
    expect(onShared).toHaveBeenCalled();
  });

  it('an empty or over-long summary cannot be sent; a refusal is said plainly', async () => {
    share.shareCard.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'no_peer' }));
    render(<ShareDialog open onClose={() => {}} city="devwork" card={CARD} title="Т" rows={[]} peer={PEER} onShared={() => {}} />);
    const box = screen.getByRole('textbox', { name: 'Что увидит Ричард' });
    const send = screen.getByRole('button', { name: 'Показать Ричарду' }) as HTMLButtonElement;
    fireEvent.change(box, { target: { value: '   ' } });
    expect(send.disabled).toBe(true);
    fireEvent.change(box, { target: { value: 'я'.repeat(601) } });
    expect(send.disabled).toBe(true);
    fireEvent.change(box, { target: { value: 'кратко' } });
    await act(async () => {
      fireEvent.click(send);
    });
    expect(screen.getByRole('alert').textContent).toBe('Не отправлено — попробуй ещё раз.');
    expect(collectMissing()).toEqual([]);
  });

  it('after share the hint reads «увидят Ричард и его Мэр»', async () => {
    render(<CardChat city="devwork" card={CARD} title="Вход по ссылке" peer={PEER} />);
    expect(screen.getByText('видите только вы и ваш Мэр')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Показать Ричарду' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.focus(within(dialog).getByRole('textbox', { name: 'Что увидит Ричард' }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Показать Ричарду' }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('увидят Ричард и его Мэр')).toBeTruthy();
    expect(screen.queryByText('видите только вы и ваш Мэр')).toBeNull();
    expect(collectMissing()).toEqual([]);
  });

  it('no peer: no share button', () => {
    render(<CardChat city="devwork" card={CARD} title="Вход" peer={null} />);
    expect(screen.queryByRole('button', { name: /Показать/ })).toBeNull();
  });
});
