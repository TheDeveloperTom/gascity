import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { setLocale } from '../i18n';
import { discussWithMayor, mayorChannelUrl } from '../lib/discussWithMayor';
import { openExternal } from '../lib/openExternal';
import { DiscussButton } from './DiscussButton';

vi.mock('../lib/discussWithMayor', () => ({
  discussWithMayor: vi.fn(),
  mayorChannelUrl: vi.fn(),
}));
vi.mock('../lib/openExternal', () => ({ openExternal: vi.fn() }));

const mockDiscuss = discussWithMayor as unknown as Mock;
const mockChannel = mayorChannelUrl as unknown as Mock;
const mockOpen = openExternal as unknown as Mock;

const CHANNEL = 'https://discord.com/channels/1/2';
const ctx = { kind: 'task' as const, beadId: 'gc-1', title: 'Задача', summary: 'Ждёт · ничего не ждёт' };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  setLocale('ru');
  mockChannel.mockReturnValue(CHANNEL);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DiscussButton', () => {
  it('opens the channel synchronously on click, then hands the Mayor the exact ctx', async () => {
    const d = deferred<string>();
    mockDiscuss.mockReturnValue(d.promise);
    render(<DiscussButton ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: 'Обсудить в Discord' }));
    // Ruling 3 (Safari/iOS): the window opens inside the click, before any await.
    expect(mockOpen).toHaveBeenCalledWith(CHANNEL);
    expect(mockDiscuss).toHaveBeenCalledWith(ctx);
    expect(mockOpen.mock.invocationCallOrder[0]).toBeLessThan(
      mockDiscuss.mock.invocationCallOrder[0] ?? 0,
    );
    await act(async () => {
      d.resolve(CHANNEL);
      await d.promise;
    });
    expect(screen.getByRole('button', { name: 'Открыто в Discord' })).toBeTruthy();
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it('shows «Передаю Мэру…» while pending, disabled', () => {
    mockDiscuss.mockReturnValue(new Promise<string>(() => {}));
    render(<DiscussButton ctx={ctx} />);
    fireEvent.click(screen.getByRole('button'));
    const btn = screen.getByRole('button', { name: 'Передаю Мэру…' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('a rejection shows «Не вышло — ещё раз» as an alert, and a click retries', async () => {
    mockDiscuss.mockRejectedValueOnce(new Error('down'));
    render(<DiscussButton ctx={ctx} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });
    const retry = screen.getByRole('alert');
    expect(retry.textContent).toContain('Не вышло — ещё раз');
    mockDiscuss.mockResolvedValueOnce(CHANNEL);
    await act(async () => {
      fireEvent.click(retry);
    });
    expect(mockDiscuss).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Открыто в Discord' })).toBeTruthy();
  });

  it('is disabled with a title when the Mayor channel is not configured', () => {
    mockChannel.mockReturnValue(null);
    render(<DiscussButton ctx={ctx} />);
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('Канал Мэра не настроен');
    fireEvent.click(btn);
    expect(mockDiscuss).not.toHaveBeenCalled();
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('takes a label override for the question card', () => {
    mockDiscuss.mockReturnValue(new Promise<string>(() => {}));
    render(<DiscussButton ctx={ctx} label="Другое — обсудить в Discord" />);
    expect(screen.getByRole('button', { name: 'Другое — обсудить в Discord' })).toBeTruthy();
  });
});
