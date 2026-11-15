import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { setLocale } from '../i18n';
import { mayorChannelUrl } from '../lib/mayorLink';
import { openExternal } from '../lib/openExternal';
import { DiscussButton } from './DiscussButton';

// Owner 16.11 (no Discord Activity): «Обсудить в Discord» opens the owner's
// Mayor channel inside the click and posts nothing.

vi.mock('../lib/mayorLink', () => ({ mayorChannelUrl: vi.fn() }));
vi.mock('../lib/openExternal', () => ({ openExternal: vi.fn() }));

const mockChannel = mayorChannelUrl as unknown as Mock;
const mockOpen = openExternal as unknown as Mock;

const CHANNEL = 'https://discord.com/channels/1/2';
const ctx = { kind: 'task' as const, beadId: 'gc-1', title: 'Задача', summary: 'Ждёт · ничего не ждёт' };

beforeEach(() => {
  setLocale('ru');
  mockChannel.mockReturnValue(CHANNEL);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DiscussButton', () => {
  it('opens the Mayor channel synchronously on click and posts nothing', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<DiscussButton ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: 'Обсудить в Discord' }));
    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(mockOpen).toHaveBeenCalledWith(CHANNEL);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('is disabled with a title when the Mayor channel is not configured', () => {
    mockChannel.mockReturnValue(null);
    render(<DiscussButton ctx={ctx} />);
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('Канал Мэра не настроен');
    fireEvent.click(btn);
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('takes a label override for the question card', () => {
    render(<DiscussButton ctx={ctx} label="Другое — обсудить в Discord" />);
    expect(screen.getByRole('button', { name: 'Другое — обсудить в Discord' })).toBeTruthy();
  });
});
