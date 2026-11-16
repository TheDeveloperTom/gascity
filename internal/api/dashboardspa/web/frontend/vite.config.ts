import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { serviceWorkerSource } from './src/pwa/swSource';

// Single-port deploy: the gc supervisor serves the SPA, the typed `/v0/*`
// API, `/health`, and the host-side `/api/*` plane on one loopback listener
// (default 127.0.0.1:8372). In dev, Vite proxies those prefixes to that
// listener so the browser stays same-origin both in dev and prod — no
// `/gc-supervisor` transport proxy, which keeps the Host-allowlist + Origin
// check + CSP simple.
// DEV_BACKEND_TARGET lets an isolated worktree stack proxy to its own
// supervisor port (pair with `vite --port <n>`), so the snap harness can
// drive it via SNAP_BASE without touching the primary :5174/:8372 pair.
const DEFAULT_BACKEND_TARGET = 'http://127.0.0.1:8372';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

// The supervisor binds 127.0.0.1 only and must never be exposed, so a custom
// dev proxy target must still resolve to loopback. Validate at config load — a
// non-loopback or malformed DEV_BACKEND_TARGET fails loudly here rather than
// silently proxying dev traffic off-host.
function resolveBackendTarget(): string {
  const raw = process.env.DEV_BACKEND_TARGET;
  if (raw === undefined) return DEFAULT_BACKEND_TARGET;
  let hostname: string;
  try {
    hostname = new URL(raw).hostname;
  } catch {
    throw new Error(`DEV_BACKEND_TARGET is not a valid URL: ${JSON.stringify(raw)}`);
  }
  // URL parsing wraps IPv6 hosts in brackets ([::1]); strip them before compare.
  const normalized = hostname.replace(/^\[|\]$/g, '');
  if (!LOOPBACK_HOSTS.has(normalized)) {
    throw new Error(
      `DEV_BACKEND_TARGET must resolve to loopback (127.0.0.1, localhost, or ::1); got ${JSON.stringify(hostname)}`,
    );
  }
  return raw;
}

export const BACKEND_TARGET = resolveBackendTarget();

interface ProxyRequest {
  hasHeader(name: string): boolean;
  setHeader(name: string, value: string): void;
}
type BackendDevProxy = {
  on(event: 'proxyReq', listener: (proxyReq: ProxyRequest) => void): void;
};

export function configureBackendDevProxy(proxy: BackendDevProxy): void {
  proxy.on('proxyReq', (proxyReq) => {
    if (proxyReq.hasHeader('origin')) {
      proxyReq.setHeader('Origin', BACKEND_TARGET);
    }
  });
}

// Owner 16.11 (PWA): emit /sw.js at build time with the build's id in its
// cache name (src/pwa/swSource.ts), so each build is a new worker and old
// shells are dropped. The id hashes the emitted file names, which already
// carry content hashes.
export function serviceWorkerPlugin(): Plugin {
  return {
    name: 'gascity-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const id = createHash('sha256').update(Object.keys(bundle).sort().join('\n')).digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorkerSource(id) });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorkerPlugin()],
  server: {
    port: 5174,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      // Host-side dashboard plane served by the supervisor.
      '/api': {
        target: BACKEND_TARGET,
        // changeOrigin rewrites the *Host* header to match the supervisor's
        // host:port so the Host-allowlist (127.0.0.1, localhost) passes.
        changeOrigin: true,
        // changeOrigin does NOT rewrite the *Origin* request header — that
        // still arrives as http://127.0.0.1:5174 (Vite's own origin). The
        // supervisor has NO Origin allow-list: the typed /v0 API needs only
        // the Host allowlist (loopback + `[supervisor] allowed_hosts`) and
        // `X-GC-Request` (huma_handlers_supervisor.go). The /api plane's
        // write guard, however, compares the Origin host with the request
        // Host (dashboardbff/plane.go sameOriginMutation), and changeOrigin
        // has made that Host 127.0.0.1:8372 — so rewrite Origin to match.
        // City services behind /v0/.../svc apply their own gate (peer-boards
        // checks Origin and Sec-Fetch-Site itself). In prod the supervisor
        // serves the SPA same-origin and this code path doesn't apply
        // (gascity-dashboard-oi7).
        configure: configureBackendDevProxy,
      },
      // Typed supervisor API. Served same-origin by the supervisor in prod;
      // proxied here in dev so the browser addresses `/v0/...` directly.
      '/v0': {
        target: BACKEND_TARGET,
        changeOrigin: true,
        // Same Origin rewrite as /api, so the Origin a dev write carries
        // matches the rewritten Host (harmless for the typed API, which
        // checks only Host and X-GC-Request).
        configure: configureBackendDevProxy,
      },
      // Supervisor liveness probe.
      '/health': {
        target: BACKEND_TARGET,
        changeOrigin: true,
        configure: configureBackendDevProxy,
      },
    },
  },
  build: {
    outDir: 'dist',
    // No prod source maps — an externally-fronted dist must not ship readable
    // source. Keep false; see specs/architecture/exposure.md.
    sourcemap: false,
    emptyOutDir: true,
  },
});
