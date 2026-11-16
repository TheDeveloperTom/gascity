import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { setLocale } from '../i18n';
import { mayorChannelUrl } from '../lib/mayorLink';
import { openExternal } from '../lib/openExternal';
import { postDiscuss } from '../supervisor/discussWrites';
import { CommentWriteError } from '../supervisor/peerCommentWrites';
import { DiscussButton } from './DiscussButton';

// Owner 16.11 (no Discord Activity): «Обсудить в Discord» opens the owner's
// Mayor channel inside the click, then (B10) tells the Mayor through
// peer-boards POST /v1/discuss. A failed post shows a small inline note and
// never blocks the link.

vi.mock('../lib/mayorLink', () => ({ mayorChannelUrl: vi.fn() }));
vi.mock('../lib/openExternal', () => ({ openExternal: vi.fn() }));
vi.mock('../supervisor/discussWrites', () => ({ postDiscuss: vi.fn() }));

const mockChannel = mayorChannelUrl as unknown as Mock;
const mockOpen = openExternal as unknown as Mock;
const mockPost = postDiscuss as unknown as Mock;

const CHANNEL = 'https://discord.com/channels/1/2';
const ctx = {
  kind: 'task' as const,
  beadId: 'gc-1',
  title: 'Задача',
  summary: 'Ждёт · ничего не ждёт',
};

beforeEach(() => {
  setLocale('ru');
  mockChannel.mockReturnValue(CHANNEL);
  mockPost.mockResolvedValue(CHANNEL);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DiscussButton', () => {
  it('opens synchronously then posts discuss once per click', async () => {
    const order: string[] = [];
    mockOpen.mockImplementation(() => order.push('open'));
    mockPost.mockImplementation(() => {
      order.push('post');
      return Promise.resolve(CHANNEL);
    });
    render(<DiscussButton ctx={ctx} />);
    const btn = screen.getByRole('button', { name: 'Обсудить в Discord' });
    fireEvent.click(btn);
    // Both happen inside the click, before any await: the open first (popup rule).
    expect(order).toEqual(['open', 'post']);
    expect(mockOpen).toHaveBeenCalledWith(CHANNEL);
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(ctx);
    fireEvent.click(btn);
    expect(mockOpen).toHaveBeenCalledTimes(2);
    expect(mockPost).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('a disabled write shows a quiet inline note and keeps the link', async () => {
    mockPost.mockRejectedValue(new CommentWriteError('disabled'));
    render(<DiscussButton ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: 'Обсудить в Discord' }));
    expect(mockOpen).toHaveBeenCalledWith(CHANNEL);
    expect((await screen.findByRole('status')).textContent).toBe('Запись здесь выключена');
  });

  it('a failed post says the Mayor was not notified', async () => {
    mockPost.mockRejectedValue(new CommentWriteError('failed'));
    render(<DiscussButton ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: 'Обсудить в Discord' }));
    expect((await screen.findByRole('status')).textContent).toBe('Не удалось уведомить Мэра');
  });

  it('is disabled with a title when the Mayor channel is not configured', () => {
    mockChannel.mockReturnValue(null);
    render(<DiscussButton ctx={ctx} />);
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('Канал Мэра не настроен');
    fireEvent.click(btn);
    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('takes a label override for the question card', () => {
    render(<DiscussButton ctx={ctx} label="Другое — обсудить в Discord" />);
    expect(screen.getByRole('button', { name: 'Другое — обсудить в Discord' })).toBeTruthy();
  });

  // polish2 16.11 (coordinator): with a channel the button must not look
  // disabled; only the disabled state is dimmed.
  it('enabled reads at normal contrast; only disabled is dimmed', () => {
    render(<DiscussButton ctx={ctx} />);
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.className.split(/\s+/)).not.toContain('text-vk-text-low');
    expect(btn.className).toContain('disabled:opacity-60');
  });
});
