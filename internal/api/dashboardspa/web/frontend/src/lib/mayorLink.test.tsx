import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveCity } from '../api/cityBase';
import { resetPeerBoardsForTests, usePeerBoards } from '../hooks/usePeerBoards';
import { setLocale } from '../i18n';
import { parsePeerBoards } from '../supervisor/peerBoardReads';
import { peerBody } from '../test/fixtures/peerBoards';
import { Button } from '../components/Button';
import { DiscussButton } from '../vk/DiscussButton';
import { mayorChannelUrl, resetMayorLinkForTests, setCityMayorUrl } from './mayorLink';

// Owner 16.11: with the Activity gone, «Обсудить с Мэром» / «Обсудить в
// Discord» open the owner's Mayor channel (#мэр). The link comes at RUNTIME
// from the city (`mayor_url` on our own peer-boards `/v1/boards`), so one
// build serves every city; `VITE_MAYOR_DISCORD_URL` is only the fallback.

const CHANNEL = 'https://discord.com/channels/111/222';

beforeEach(() => {
  resetMayorLinkForTests();
  setLocale('ru');
});
afterEach(() => {
  cleanup();
  resetPeerBoardsForTests();
  resetMayorLinkForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setLocale('en');
});

describe('the Mayor link', () => {
  it('our city service sends mayor_url; only a Discord channel URL is kept', () => {
    expect(parsePeerBoards(peerBody({ top: { mayor_url: CHANNEL } })).mayorUrl).toBe(CHANNEL);
    expect(parsePeerBoards(peerBody({ top: { mayor_url: 'https://evil.example/x' } })).mayorUrl).toBeNull();
    expect(parsePeerBoards(peerBody()).mayorUrl).toBeNull();
  });

  it('runtime from the city wins over the build-time fallback; nothing at all is null', () => {
    expect(mayorChannelUrl()).toBeNull();
    vi.stubEnv('VITE_MAYOR_DISCORD_URL', 'https://discord.com/channels/9/9');
    expect(mayorChannelUrl()).toBe('https://discord.com/channels/9/9');
    setCityMayorUrl(CHANNEL);
    expect(mayorChannelUrl()).toBe(CHANNEL);
    setCityMayorUrl('javascript:alert(1)');
    expect(mayorChannelUrl()).toBe('https://discord.com/channels/9/9');
  });

  it('reading the boards hands the city’s mayor_url to the buttons', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(peerBody({ top: { mayor_url: CHANNEL } })), { status: 200 })),
    );
    renderHook(() => usePeerBoards());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mayorChannelUrl()).toBe(CHANNEL);
  });

  it('«Обсудить в Discord» opens the Mayor channel in the normal build, then tells the Mayor (B10)', () => {
    setCityMayorUrl(CHANNEL);
    setActiveCity('test-city');
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: CHANNEL }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    render(<DiscussButton ctx={{ kind: 'task', beadId: 'dw-1', title: 't', summary: 's' }} />);
    const button = screen.getByRole('button', { name: /Обсудить в Discord/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(open).toHaveBeenCalledWith(CHANNEL, '_blank', 'noopener,noreferrer');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/v0/city/test-city/svc/peer-boards/v1/discuss');
  });

  it('no link anywhere: the button is disabled and says why', () => {
    render(<DiscussButton ctx={{ kind: 'task', beadId: 'dw-1', title: 't', summary: 's' }} />);
    const button = screen.getByRole('button', { name: /Обсудить в Discord/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title.length).toBeGreaterThan(0);
  });
});

describe('mobile polish', () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'index.css'), 'utf8');

  it('form fields are 16 px on phones, so iOS never zooms on focus', () => {
    expect(css).toMatch(
      /@media \(max-width: 767px\)\s*\{\s*input,\s*select,\s*textarea\s*\{\s*font-size: max\(16px, 1em\);/,
    );
  });

  it('the small Button is a 44 px tap target on phones and 32 px from md', () => {
    render(<Button size="sm">Обновить</Button>);
    const cls = screen.getByRole('button', { name: 'Обновить' }).className.split(/\s+/);
    expect(cls).toContain('h-11');
    expect(cls).toContain('md:h-8');
    expect(cls).not.toContain('h-8');
  });

  it('safe areas come from env() only (no Activity variables)', () => {
    expect(css).toContain('--saib: env(safe-area-inset-bottom, 0px);');
    expect(css).toContain('--sait: env(safe-area-inset-top, 0px);');
  });
});
