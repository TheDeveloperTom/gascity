import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from './lib/pwa';
import { serviceWorkerSource } from './pwa/swSource';

// Owner 16.11: the dashboard is a normal web app on Tailscale, installable on
// the phone (Android Chrome install prompt, iOS «На экран Домой» standalone).

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const pub = join(root, 'public');

type Icon = { src: string; sizes: string; type: string; purpose?: string };
const manifest = JSON.parse(readFileSync(join(pub, 'manifest.webmanifest'), 'utf8')) as {
  name: string;
  short_name: string;
  display: string;
  start_url: string;
  scope: string;
  theme_color: string;
  background_color: string;
  icons: Icon[];
};
const html = readFileSync(join(root, 'index.html'), 'utf8');

function pngSize(file: string): [number, number] {
  const buf = readFileSync(file);
  expect(buf.subarray(1, 4).toString('latin1')).toBe('PNG');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe('web app manifest', () => {
  it('names «Gas City», opens standalone at the root, dark colours', () => {
    expect(manifest.name).toBe('Gas City');
    expect(manifest.short_name.length).toBeGreaterThan(0);
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    // the dark ground of the app (#1A1B1E), so the splash never flashes white
    expect(manifest.theme_color.toLowerCase()).toBe('#1a1b1e');
    expect(manifest.background_color.toLowerCase()).toBe('#1a1b1e');
  });

  it('has 192, 512 and a maskable 512 icon, real PNGs of those sizes', () => {
    const want = [
      ['192x192', 'any'],
      ['512x512', 'any'],
      ['512x512', 'maskable'],
    ];
    for (const [sizes, purpose] of want) {
      const icon = manifest.icons.find((i) => i.sizes === sizes && (i.purpose ?? 'any') === purpose);
      expect(icon, `${sizes} ${purpose}`).toBeDefined();
      expect(icon!.type).toBe('image/png');
      const n = Number(sizes.split('x')[0]);
      expect(pngSize(join(pub, icon!.src.replace(/^\//, '')))).toEqual([n, n]);
    }
  });
});

describe('index.html', () => {
  it('links the manifest, the apple touch icon and the iOS standalone meta', () => {
    expect(html).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/);
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png"/);
    expect(pngSize(join(pub, 'icons', 'apple-touch-icon.png'))).toEqual([180, 180]);
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('<meta name="mobile-web-app-capable" content="yes"');
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Gas City"');
    expect(html).toMatch(/<meta name="theme-color" content="#1A1B1E"/i);
    expect(html).toContain('<title>Gas City</title>');
  });

  it('keeps viewport-fit=cover (safe areas) and does not block pinch zoom', () => {
    const viewport = html.match(/<meta name="viewport" content="([^"]*)"/)?.[1] ?? '';
    expect(viewport).toContain('viewport-fit=cover');
    expect(viewport).not.toMatch(/user-scalable\s*=\s*no|maximum-scale/);
  });
});

describe('service worker', () => {
  const sw = serviceWorkerSource('b1234567');

  it('has a versioned cache name from the build, and activate drops only older shells', async () => {
    expect(sw).toContain("const CACHE = 'gascity-shell-b1234567'");
    expect(serviceWorkerSource('other')).not.toEqual(sw);
    expect(() => serviceWorkerSource("x'; alert(1); '")).toThrow();
    const handlers: Record<string, (e: unknown) => void> = {};
    const self = {
      location: { origin: 'https://mac.ts.net' },
      addEventListener: (name: string, fn: (e: unknown) => void) => {
        handlers[name] = fn;
      },
      skipWaiting: vi.fn(),
      clients: { claim: vi.fn() },
    };
    const caches = {
      keys: vi.fn(async () => ['gascity-shell-old1', 'gascity-shell-b1234567', 'someone-else']),
      delete: vi.fn(async () => true),
    };
    new Function('self', 'caches', 'fetch', sw)(self, caches, vi.fn());
    let done: Promise<unknown> | null = null;
    handlers.activate?.({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect(caches.delete.mock.calls).toEqual([['gascity-shell-old1']]);
    expect(self.clients.claim).toHaveBeenCalled();
  });

  // the worker runs against a fake cache: API responses are never stored
  async function runFetch(url: string, mode: RequestMode = 'cors') {
    const store = new Map<string, Response>();
    const handlers: Record<string, (e: unknown) => void> = {};
    const self = {
      location: { origin: 'https://mac.ts.net' },
      addEventListener: (name: string, fn: (e: unknown) => void) => {
        handlers[name] = fn;
      },
      skipWaiting: vi.fn(),
      clients: { claim: vi.fn() },
    };
    const cache = {
      addAll: vi.fn(async () => undefined),
      put: vi.fn(async (req: Request | string, res: Response) => {
        store.set(typeof req === 'string' ? req : req.url, res);
      }),
      match: vi.fn(async (req: Request | string) => store.get(typeof req === 'string' ? req : req.url)),
    };
    const caches = {
      open: vi.fn(async () => cache),
      keys: vi.fn(async () => []),
      delete: vi.fn(),
      match: vi.fn(async () => undefined),
    };
    const fetchFn = vi.fn(async () => new Response('ok', { status: 200 }));
    new Function('self', 'caches', 'fetch', sw)(self, caches, fetchFn);
    let responded: Promise<Response> | null = null;
    const request = new Request(url);
    Object.defineProperty(request, 'mode', { value: mode });
    handlers.fetch?.({ request, respondWith: (p: Promise<Response>) => (responded = p) });
    if (responded !== null) await responded;
    await new Promise((r) => setTimeout(r, 0));
    return { responded: responded !== null, puts: cache.put.mock.calls.length };
  }

  it('never touches API, service or event-stream requests', async () => {
    for (const url of [
      'https://mac.ts.net/v0/city/devwork-platform/beads',
      'https://mac.ts.net/v0/city/devwork-platform/svc/peer-boards/v1/boards',
      'https://mac.ts.net/v0/city/devwork-platform/events/stream',
      'https://mac.ts.net/health',
      'https://evil.example/assets/x.js',
    ]) {
      const r = await runFetch(url);
      expect(r, url).toEqual({ responded: false, puts: 0 });
    }
  });

  it('caches the shell: hashed assets and the page itself', async () => {
    expect((await runFetch('https://mac.ts.net/assets/index-abc.js')).puts).toBe(1);
    expect((await runFetch('https://mac.ts.net/city/devwork-platform/beads', 'navigate')).responded).toBe(true);
  });
});

describe('registration', () => {
  it('registers /sw.js at scope / in a production build only', async () => {
    const register = vi.fn(async () => ({}) as ServiceWorkerRegistration);
    const nav = { serviceWorker: { register } } as unknown as Navigator;
    await registerServiceWorker({ prod: false, nav });
    expect(register).not.toHaveBeenCalled();
    await registerServiceWorker({ prod: true, nav });
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('a browser without service workers is fine', async () => {
    await expect(registerServiceWorker({ prod: true, nav: {} as Navigator })).resolves.toBeUndefined();
  });

  it('the build emits sw.js through the vite plugin', () => {
    const config = readFileSync(join(root, 'vite.config.ts'), 'utf8');
    expect(config).toContain('serviceWorkerPlugin');
    expect(existsSync(join(here, 'pwa', 'swSource.ts'))).toBe(true);
  });
});
