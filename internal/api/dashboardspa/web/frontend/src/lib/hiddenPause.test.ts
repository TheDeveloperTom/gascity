import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HIDDEN_PAUSE_MS, watchHiddenPause } from './hiddenPause';

// BOARD-CHAT D3 live check 19.11, HOST cause 5: a tab with an open card holds
// three long-lived streams, and Chromium allows six HTTP/1.1 connections per
// host, so a second tab left no connection for the chat's POST /v1/send. A tab
// that stays hidden gives its streams back.

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  setHidden(false);
});
afterEach(() => {
  setHidden(false);
  vi.useRealTimers();
});

describe('watchHiddenPause', () => {
  it('pauses once the page has stayed hidden for the grace time, resumes when visible', () => {
    const pause = vi.fn();
    const resume = vi.fn();
    const stop = watchHiddenPause({ pause, resume });
    setHidden(true);
    vi.advanceTimersByTime(HIDDEN_PAUSE_MS - 1);
    expect(pause).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(pause).toHaveBeenCalledTimes(1);
    setHidden(false);
    expect(resume).toHaveBeenCalledTimes(1);
    stop();
  });

  it('a quick tab switch neither pauses nor resumes', () => {
    const pause = vi.fn();
    const resume = vi.fn();
    const stop = watchHiddenPause({ pause, resume });
    setHidden(true);
    vi.advanceTimersByTime(HIDDEN_PAUSE_MS / 2);
    setHidden(false);
    vi.advanceTimersByTime(HIDDEN_PAUSE_MS * 2);
    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    stop();
  });

  it('a page opened in a background tab pauses after the grace time', () => {
    setHidden(true);
    const pause = vi.fn();
    const stop = watchHiddenPause({ pause, resume: vi.fn() });
    vi.advanceTimersByTime(HIDDEN_PAUSE_MS);
    expect(pause).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stop cancels a pending pause and ignores later changes', () => {
    const pause = vi.fn();
    const resume = vi.fn();
    const stop = watchHiddenPause({ pause, resume });
    setHidden(true);
    stop();
    vi.advanceTimersByTime(HIDDEN_PAUSE_MS * 2);
    setHidden(false);
    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });
});
