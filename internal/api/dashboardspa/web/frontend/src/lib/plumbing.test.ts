import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiBase, withApiBase } from './apiBase';
import { openExternal } from './openExternal';
import { hardNavigate } from './navigation';
import { discussWithMayor, mayorChannelUrl } from './discussWithMayor';
import { resetMayorLinkForTests } from './mayorLink';
import { ExternalLink } from '../vk/ExternalLink';
import { api } from '../api/client';
import { resolveSupervisorBaseUrl } from '../supervisor/url';

// The plain web app's plumbing seams (owner 16.11: no Discord Activity):
// one API base, one exit for external links, one full reload, and the
// Mayor's Discord channel for «Обсудить».

const DISCORD = 'https://discord.com/channels/1/2/3';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetMayorLinkForTests();
});

describe('apiBase / withApiBase', () => {
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

  it('supervisor base is origin + apiBase when no supervisor URL is configured', () => {
    vi.stubEnv('VITE_GC_SUPERVISOR_URL', '');
    vi.stubEnv('VITE_API_BASE', '/c/tom');
    expect(resolveSupervisorBaseUrl()).toBe(`${window.location.origin}/c/tom`);
  });
});

describe('api client', () => {
  it('a GET keeps the base and sends no session headers', async () => {
    vi.stubEnv('VITE_API_BASE', '/c/tom');
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.config().catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url).startsWith('/c/tom/')).toBe(true);
    expect(Object.keys((init?.headers as Record<string, string>) ?? {})).not.toContain('Authorization');
  });
});

describe('openExternal', () => {
  it('does not open a javascript: URL', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternal('javascript:x');
    expect(open).not.toHaveBeenCalled();
  });

  it('opens a Discord URL in a new window', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternal(DISCORD);
    expect(open).toHaveBeenCalledWith(DISCORD, '_blank', 'noopener,noreferrer');
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
      value: { ...window.location, search: '?project=a', assign },
    });
  });
  afterEach(() => {
    if (original !== undefined) Object.defineProperty(window, 'location', original);
  });

  it('keeps the current query when the path has none', () => {
    hardNavigate('/city/x/');
    expect(assign).toHaveBeenCalledWith('/city/x/?project=a');
  });

  it('keeps the path query when it has one', () => {
    hardNavigate('/city/x/?bead=1');
    expect(assign).toHaveBeenCalledWith('/city/x/?bead=1');
  });
});

describe('discussWithMayor', () => {
  it('resolves to the Mayor channel, posting nothing', async () => {
    vi.stubEnv('VITE_MAYOR_DISCORD_URL', 'https://discord.com/channels/1/2');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(mayorChannelUrl()).toBe('https://discord.com/channels/1/2');
    await expect(discussWithMayor({ kind: 'task', beadId: 'dw-1', title: 'T', summary: 'S' })).resolves.toBe(
      'https://discord.com/channels/1/2',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when unset or not a Discord channel', async () => {
    vi.stubEnv('VITE_MAYOR_DISCORD_URL', '');
    await expect(discussWithMayor({ kind: 'need', beadId: 'dw-1', title: 'T', summary: 'S' })).rejects.toThrow();
    vi.stubEnv('VITE_MAYOR_DISCORD_URL', 'https://evil.example/channels/1/2');
    expect(mayorChannelUrl()).toBeNull();
  });
});
