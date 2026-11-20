// Discord mode request seam: re-sign-in backoff and the «no access» stop
// (fork PR #7 review M1).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enterDiscordFrame, leaveDiscordFrame } from '../test/discordFrame';
import {
  gatedFetch,
  isDenied,
  REAUTH_BACKOFF_MAX_MS,
  REAUTH_BACKOFF_MIN_MS,
  setDenied,
  setReauth,
  subscribeDenied,
} from './session';

const invalid = () =>
  new Response(JSON.stringify({ error: 'session_invalid' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
const ok = () =>
  new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
const URL_ = '/v0/city/test-city/rigs';

beforeEach(() => {
  vi.useFakeTimers();
  enterDiscordFrame();
});
afterEach(() => {
  vi.useRealTimers();
  leaveDiscordFrame();
});

describe('re-sign-in backoff', () => {
  it('after a failed re-sign-in, no new one until the cool-down has passed', async () => {
    const reauth = vi.fn(async () => {
      throw new Error('token 429');
    });
    setReauth(reauth);
    const net = vi.fn(async () => invalid());
    expect((await gatedFetch(net, URL_)).status).toBe(401);
    expect(reauth).toHaveBeenCalledTimes(1);
    // the 3 s launch poll and the 15 s refresh keep getting 401 inside the window
    for (let i = 0; i < 5; i += 1) {
      await vi.advanceTimersByTimeAsync(3_000);
      expect((await gatedFetch(net, URL_)).status).toBe(401);
    }
    expect(reauth).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(REAUTH_BACKOFF_MIN_MS);
    await gatedFetch(net, URL_);
    expect(reauth).toHaveBeenCalledTimes(2);
  });

  it('the cool-down doubles after each failure, capped', async () => {
    const reauth = vi.fn(async () => {
      throw new Error('down');
    });
    setReauth(reauth);
    const net = vi.fn(async () => invalid());
    let wait = REAUTH_BACKOFF_MIN_MS;
    await gatedFetch(net, URL_);
    for (let n = 2; n <= 6; n += 1) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      await gatedFetch(net, URL_);
      expect(reauth).toHaveBeenCalledTimes(n - 1);
      await vi.advanceTimersByTimeAsync(1);
      await gatedFetch(net, URL_);
      expect(reauth).toHaveBeenCalledTimes(n);
      wait = Math.min(wait * 2, REAUTH_BACKOFF_MAX_MS);
    }
  });

  it('a successful re-sign-in resets the cool-down and retries the request', async () => {
    let fail = true;
    const reauth = vi.fn(async () => {
      if (fail) throw new Error('down');
    });
    setReauth(reauth);
    const replies = [invalid(), invalid(), ok()];
    const net = vi.fn(async () => replies.shift() ?? ok());
    await gatedFetch(net, URL_);
    await vi.advanceTimersByTimeAsync(REAUTH_BACKOFF_MIN_MS);
    fail = false;
    expect((await gatedFetch(net, URL_)).status).toBe(200);
    expect(reauth).toHaveBeenCalledTimes(2);
  });
});

describe('no access (403 on sign-in): everything stops', () => {
  it('once denied, no request leaves the frame and subscribers hear it once', async () => {
    const heard = vi.fn();
    const stop = subscribeDenied(heard);
    setDenied();
    setDenied();
    expect(isDenied()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
    const net = vi.fn(async () => ok());
    expect((await gatedFetch(net, URL_)).status).toBe(403);
    expect(net).not.toHaveBeenCalled();
    stop();
  });
});
