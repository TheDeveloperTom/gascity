import { createElement } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { setActiveCity } from '../api/cityBase';
import { POLL_FALLBACK_MS, useGcEventRefresh } from '../hooks/useGcEvents';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiBase,
  authHeaders,
  isEmbedded,
  resetActivityPlumbingForTests,
  setAuthHeaders,
  withApiBase,
} from './apiBase';
import { openExternal, setExternalOpener } from './openExternal';
import { hardNavigate } from './navigation';
import { answerQuestion } from './answerQuestion';
import {
  answerQuestion as answerQuestionWire,
  discussWithMayor,
  mayorChannelUrl,
} from './discussWithMayor';
import { ExternalLink } from '../vk/ExternalLink';
import { api } from '../api/client';
import { resolveSupervisorBaseUrl } from '../supervisor/url';

// vk lane 6 — Discord Activity plumbing seams (one test file for all of them).

const DISCORD = 'https://discord.com/channels/1/2/3';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetActivityPlumbingForTests();
});

describe('apiBase / withApiBase / authHeaders', () => {
  it('prefixes root-relative paths with VITE_API_BASE', () => {
    vi.stubEnv('VITE_API_BASE', '/c/tom/');
    expect(apiBase()).toBe('/c/tom');
    expect(withApiBase('/v0/cities')).toBe('/c/tom/v0/cities');
    expect(withApiBase('https://x.example/v0')).toBe('https://x.example/v0');
  });

  it('leaves paths unchanged with no env', () => {
    vi.stubEnv('VITE_API_BASE', '');
    expect(apiBase()).toBe('');
    expect(withApiBase('/v0/cities')).toBe('/v0/cities');
  });

  it('authHeaders is empty until setAuthHeaders, and returns a copy', () => {
    expect(authHeaders()).toEqual({});
    setAuthHeaders({ Authorization: 'Bearer t', 'X-Activity-Instance': 'i' });
    const h = authHeaders();
    expect(h).toEqual({ Authorization: 'Bearer t', 'X-Activity-Instance': 'i' });
    h.Authorization = 'mutated';
    expect(authHeaders().Authorization).toBe('Bearer t');
  });

  it('supervisor base is origin + apiBase when no supervisor URL is configured', () => {
    vi.stubEnv('VITE_GC_SUPERVISOR_URL', '');
    vi.stubEnv('VITE_API_BASE', '/c/tom');
    expect(resolveSupervisorBaseUrl()).toBe(`${window.location.origin}/c/tom`);
  });

  it('isEmbedded is true with frame_id in the URL, and stays true after navigation', () => {
    expect(isEmbedded()).toBe(false);
    window.history.replaceState(null, '', '/?frame_id=a&instance_id=b');
    expect(isEmbedded()).toBe(true);
    window.history.replaceState(null, '', '/city/x/beads');
    expect(isEmbedded()).toBe(true);
  });

  it('isEmbedded honours VITE_EMBED', () => {
    window.history.replaceState(null, '', '/');
    vi.stubEnv('VITE_EMBED', '1');
    expect(isEmbedded()).toBe(true);
  });
});

describe('api client', () => {
  it('a GET sends the authHeaders keys and keeps the base', async () => {
    vi.stubEnv('VITE_API_BASE', '/c/tom');
    setAuthHeaders({ 'X-Test': '1' });
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.config().catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url).startsWith('/c/tom/')).toBe(true);
    expect((init?.headers as Record<string, string>)['X-Test']).toBe('1');
  });
});

describe('openExternal', () => {
  it('does not open a javascript: URL', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternal('javascript:x');
    expect(open).not.toHaveBeenCalled();
  });

  it('opens a Discord URL', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternal(DISCORD);
    expect(open).toHaveBeenCalledWith(DISCORD, '_blank', 'noopener,noreferrer');
  });

  it('uses the injected opener synchronously and swallows its rejection', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const opener = vi.fn(async () => {
      throw new Error('INVALID_COMMAND');
    });
    setExternalOpener(opener);
    openExternal(DISCORD);
    expect(opener).toHaveBeenCalledWith(DISCORD);
    expect(open).not.toHaveBeenCalled();
  });
});

describe('ExternalLink', () => {
  it('a click calls openExternal and the element has no target', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(createElement(ExternalLink, { href: DISCORD }, 'go'));
    const a = screen.getByRole('link', { name: 'go' });
    expect(a.hasAttribute('target')).toBe(false);
    fireEvent.click(a);
    expect(open).toHaveBeenCalledWith(DISCORD, '_blank', 'noopener,noreferrer');
  });
});

describe('hardNavigate', () => {
  const original = Object.getOwnPropertyDescriptor(window, 'location');
  const assign = vi.fn();
  beforeEach(() => {
    assign.mockReset();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, search: '?frame_id=a&instance_id=b', assign },
    });
  });
  afterEach(() => {
    if (original !== undefined) Object.defineProperty(window, 'location', original);
  });

  it('keeps the launch query when the path has none', () => {
    hardNavigate('/city/x/');
    expect(assign).toHaveBeenCalledWith('/city/x/?frame_id=a&instance_id=b');
  });

  it('keeps the path query when it has one', () => {
    hardNavigate('/city/x/?bead=1');
    expect(assign).toHaveBeenCalledWith('/city/x/?bead=1');
  });
});

describe('answerQuestion (UI seam)', () => {
  it('opens q.chatUrl', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    answerQuestion({ questionId: 'q1', chatUrl: DISCORD }, null);
    expect(open).toHaveBeenCalledWith(DISCORD, '_blank', 'noopener,noreferrer');
  });

  it('opens q.chatUrl synchronously for a choice too, never throwing', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(() => answerQuestion({ questionId: 'q1', chatUrl: DISCORD }, 1)).not.toThrow();
    expect(open).toHaveBeenCalledWith(DISCORD, '_blank', 'noopener,noreferrer');
  });
});

describe('stream fallback (useGcEventRefresh)', () => {
  class FakeES {
    static readonly CLOSED = 2;
    static all: FakeES[] = [];
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((e: MessageEvent<string>) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    constructor(readonly url: string) {
      FakeES.all.push(this);
    }
    addEventListener(): void {}
    close(): void {
      this.readyState = 2;
    }
  }

  it('polls the refresh path after 2 consecutive errors and stops once the stream opens', () => {
    vi.useFakeTimers();
    FakeES.all = [];
    vi.stubGlobal('EventSource', FakeES);
    setActiveCity('devwork');
    const onMatch = vi.fn();
    renderHook(() => useGcEventRefresh(['bead.'], onMatch));
    act(() => FakeES.all[0]?.onerror?.(new Event('error')));
    act(() => {
      vi.advanceTimersByTime(POLL_FALLBACK_MS);
    });
    expect(onMatch).not.toHaveBeenCalled();
    act(() => FakeES.all[FakeES.all.length - 1]?.onerror?.(new Event('error')));
    act(() => {
      vi.advanceTimersByTime(POLL_FALLBACK_MS);
    });
    expect(onMatch).toHaveBeenCalled();
    const calls = onMatch.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    act(() => FakeES.all[FakeES.all.length - 1]?.onopen?.());
    act(() => {
      vi.advanceTimersByTime(POLL_FALLBACK_MS * 3);
    });
    expect(onMatch.mock.calls.length).toBeLessThanOrEqual(calls + 3);
    const afterOpen = onMatch.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(POLL_FALLBACK_MS * 3);
    });
    expect(onMatch.mock.calls.length).toBe(afterOpen);
    vi.useRealTimers();
  });
});

describe('discussWithMayor interface', () => {
  it('resolves to the channel URL when it is a Discord channel URL', async () => {
    vi.stubEnv('VITE_MAYOR_DISCORD_URL', 'https://discord.com/channels/1/2');
    expect(mayorChannelUrl()).toBe('https://discord.com/channels/1/2');
    await expect(
      discussWithMayor({ kind: 'task', beadId: 'dw-1', title: 'T', summary: 'S' }),
    ).resolves.toBe('https://discord.com/channels/1/2');
  });

  it('rejects when unset', async () => {
    vi.stubEnv('VITE_MAYOR_DISCORD_URL', '');
    expect(mayorChannelUrl()).toBeNull();
    await expect(
      discussWithMayor({ kind: 'need', beadId: 'dw-1', title: 'T', summary: 'S' }),
    ).rejects.toThrow();
  });

  it('rejects a non-Discord URL', async () => {
    vi.stubEnv('VITE_MAYOR_DISCORD_URL', 'https://evil.example/channels/1/2');
    expect(mayorChannelUrl()).toBeNull();
    await expect(
      discussWithMayor({ kind: 'task', beadId: 'dw-1', title: 'T', summary: 'S' }),
    ).rejects.toThrow();
  });

  it('answerQuestion(qid, choiceIndex) never posts outside the Activity: rejects «not embedded»', async () => {
    window.history.replaceState(null, '', '/');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const p: Promise<void> = answerQuestionWire('0123456789abcdef01234567', 0);
    await expect(p).rejects.toThrow(/not embedded/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answerQuestion(qid, choiceIndex) inside the Activity before sign-in posts nothing (no role yet)', async () => {
    window.history.replaceState(null, '', '/?frame_id=a&instance_id=b');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(answerQuestionWire('0123456789abcdef01234567', 0)).rejects.toThrow(/owner only/);
    expect(fetchMock).not.toHaveBeenCalled();
    window.history.replaceState(null, '', '/');
  });
});
