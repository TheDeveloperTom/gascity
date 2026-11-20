// main.tsx: the plain web app boots exactly as before (mount, then the
// service worker; the SDK chunk is never requested); only a real Discord
// Activity frame loads the SDK chunk, signs in first and registers no worker.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_ID,
  DISCORD_ORIGIN,
  enterDiscordFrame,
  leaveDiscordFrame,
  moveTo,
} from '../test/discordFrame';

const m = vi.hoisted(() => ({
  sdkLoaded: 0,
  boot: vi.fn(async (_id: string | null, _root: HTMLElement) => true),
  render: vi.fn(),
  register: vi.fn(async (_o: unknown) => undefined),
}));

vi.mock('./activitySdk', () => {
  m.sdkLoaded += 1;
  return { runActivityBoot: m.boot };
});
vi.mock('react-dom/client', () => ({
  default: { createRoot: () => ({ render: m.render }) },
  createRoot: () => ({ render: m.render }),
}));
vi.mock('../lib/pwa', () => ({ registerServiceWorker: m.register }));
vi.mock('../CityBootstrap', () => ({ CityBootstrap: () => null }));

beforeEach(() => {
  vi.resetModules();
  m.sdkLoaded = 0;
  m.boot.mockClear();
  m.render.mockClear();
  m.register.mockClear();
  const root = document.createElement('div');
  root.id = 'root';
  document.body.replaceChildren(root);
});

afterEach(() => {
  leaveDiscordFrame();
});

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('main.tsx boot gate', () => {
  it('plain web: mounts at once, registers the service worker, never loads the SDK', async () => {
    leaveDiscordFrame();
    await import('../main');
    await settle();
    expect(m.render).toHaveBeenCalledTimes(1);
    expect(m.register).toHaveBeenCalledTimes(1);
    expect(m.sdkLoaded).toBe(0);
    expect(m.boot).not.toHaveBeenCalled();
  });

  it('a discordsays-looking host without the SDK launch params is plain web', async () => {
    moveTo(`${DISCORD_ORIGIN}/city/test-city/beads`);
    await import('../main');
    await settle();
    expect(m.sdkLoaded).toBe(0);
  });

  it('inside Discord: loads the SDK chunk, signs in with the proxy host app id, then mounts; no worker', async () => {
    enterDiscordFrame('/');
    await import('../main');
    await settle();
    await settle();
    expect(m.sdkLoaded).toBe(1);
    expect(m.boot).toHaveBeenCalledWith(APP_ID, document.getElementById('root'));
    expect(m.render).toHaveBeenCalledTimes(1);
    expect(m.register).not.toHaveBeenCalled();
  });

  it('inside Discord, a refused sign-in never mounts the board', async () => {
    enterDiscordFrame('/');
    m.boot.mockResolvedValueOnce(false);
    await import('../main');
    await settle();
    await settle();
    expect(m.render).not.toHaveBeenCalled();
  });
});
