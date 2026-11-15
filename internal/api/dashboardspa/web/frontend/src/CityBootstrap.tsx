import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserRouter } from 'react-router';
import { CITY_NAME_RE } from 'gas-city-dashboard-shared';
import type { CityInfo } from 'gas-city-dashboard-shared/gc-supervisor';
import { App } from './App';
import { setActiveCity } from './api/cityBase';
import { Button } from './components/Button';
import { supervisorApi } from './supervisor/client';
import { bareRedirectTarget } from './lib/cityRedirect';
import { hardNavigate } from './lib/navigation';
import { ExternalLink } from './vk/ExternalLink';

// gascity-dashboard-ucc — city bootstrap.
//
// The dashboard addresses one city at a time via the `/city/:cityName/*`
// URL. This component sits ABOVE the router and resolves which city the
// browser is on BEFORE the route tree (and any city-scoped fetch) mounts:
//
//  - URL already carries a valid `/city/:cityName` segment -> verify the city
//    is registered, then set it active and mount the app under that segment
//    as the router basename, so every existing absolute in-app link
//    (`to="/agents"`) stays city-relative without per-link churn. A
//    grammar-valid but unregistered/renamed city renders an explicit unknown
//    -city screen rather than a fully-degraded app
//    (gascity-dashboard-ux-stale-city-url-no-recovery). A listCities NETWORK
//    error does NOT block mounting — a transient blip must not lock the
//    operator out of a city that is in fact registered; the city-scoped reads
//    then surface their own errors.
//  - No city segment (e.g. a bare `/`) -> fetch the city registry and
//    redirect to the first city. A not-running city is still selectable;
//    its city-scoped reads surface a city-level error rather than the
//    bootstrap silently skipping to a different one.

const GETTING_STARTED_URL = 'https://docs.gascity.com/getting-started/quickstart';

const CITY_SEGMENT_RE = /^\/city\/([^/]+)(?:\/|$)/;

interface ParsedCity {
  cityName: string;
  /** Router basename: everything up to and including `/city/:cityName`. */
  basename: string;
}

function parseCityFromPath(pathname: string): ParsedCity | null {
  const match = CITY_SEGMENT_RE.exec(pathname);
  if (match === null) return null;
  const raw = match[1];
  if (raw === undefined) return null;
  let cityName: string;
  try {
    cityName = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!CITY_NAME_RE.test(cityName)) return null;
  return { cityName, basename: `/city/${raw}` };
}

type BootstrapState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'empty' }
  // The URL names a city that loaded successfully but is not registered.
  | { phase: 'unknown-city'; cities: readonly CityInfo[] }
  // Mount the app: either the URL city is a confirmed member, or the list
  // fetch failed transiently and we refuse to lock the operator out.
  | { phase: 'mount' };

export function CityBootstrap() {
  // Parsed once from the URL, then set again (state, vk lane 6) when the
  // bare-`/` branch rewrites the URL in place. The effect below is keyed on
  // the retry nonce only and reads `parsed` through a ref, so that rewrite
  // does not refetch the cities or loop.
  const [parsed, setParsed] = useState<ParsedCity | null>(() =>
    parseCityFromPath(window.location.pathname),
  );
  const parsedRef = useRef(parsed);
  parsedRef.current = parsed;
  const [state, setState] = useState<BootstrapState>({ phase: 'loading' });
  // Bumped by the Retry button to re-run the cities fetch without a full page
  // reload (gascity-dashboard-ux-no-cities-dead-end).
  const [retryNonce, setRetryNonce] = useState(0);
  const retry = useCallback(() => {
    setState({ phase: 'loading' });
    setRetryNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const parsed = parsedRef.current;
    setState({ phase: 'loading' });
    supervisorApi()
      .listCities()
      .then((list) => {
        if (cancelled) return;
        const items = list.items ?? [];
        if (parsed !== null) {
          // URL carries a city — confirm it is registered before mounting.
          const known = items.some((c) => c.name === parsed.cityName);
          setState(known ? { phase: 'mount' } : { phase: 'unknown-city', cities: items });
          return;
        }
        const first = items[0];
        if (first === undefined) {
          setState({ phase: 'empty' });
          return;
        }
        // No hard redirect: rewrite the URL in place and mount under the
        // chosen city's basename. The view path, query and hash survive
        // (RB13), and the installed app does not flash a reload.
        const target = bareRedirectTarget(first.name, window.location);
        const next = parseCityFromPath(new URL(target, 'http://bootstrap.invalid').pathname);
        if (next === null) {
          hardNavigate(target);
          return;
        }
        window.history.replaceState(null, '', target);
        parsedRef.current = next;
        setParsed(next);
        setState({ phase: 'mount' });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (parsed !== null) {
          // Transient list failure must not lock the operator out of a city
          // that may well be registered — mount and let the city-scoped reads
          // surface their own errors.
          setState({ phase: 'mount' });
          return;
        }
        setState({
          phase: 'error',
          message: err instanceof Error ? err.message : 'failed to load cities',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [retryNonce]);

  if (parsed !== null && state.phase === 'mount') {
    // Make the active city available to every city-scoped fetch before the
    // route tree mounts. Synchronous so the first paint's fetches are scoped.
    setActiveCity(parsed.cityName);
    return (
      <BrowserRouter basename={parsed.basename}>
        <App />
      </BrowserRouter>
    );
  }

  if (state.phase === 'unknown-city' && parsed !== null) {
    return <UnknownCityScreen cityName={parsed.cityName} cities={state.cities} />;
  }

  if (state.phase === 'empty') {
    return <NoCitiesScreen />;
  }

  if (state.phase === 'error') {
    return <CitiesErrorScreen message={state.message} onRetry={retry} />;
  }

  // Loading (the parsed-city verify, or the bare-`/` first-city resolve).
  return (
    <BootstrapShell>
      <div className="text-body text-fg-muted">Resolving city…</div>
    </BootstrapShell>
  );
}

function BootstrapShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-10 text-fg antialiased sm:px-6">
      <div className="w-full max-w-[40rem] space-y-4 rounded-lg border border-rule bg-surface-raised p-6 sm:p-8">
        {children}
      </div>
    </div>
  );
}

function UnknownCityScreen({
  cityName,
  cities,
}: {
  cityName: string;
  cities: readonly CityInfo[];
}) {
  return (
    <BootstrapShell>
      <section role="alert" className="space-y-4">
        <h1 className="text-headline font-semibold text-fg">
          City &ldquo;{cityName}&rdquo; is not registered on this supervisor.
        </h1>
        {cities.length > 0 ? (
          <div className="space-y-2">
            <p className="text-body text-fg-muted">Available cities:</p>
            <ul className="space-y-1">
              {cities.map((c) => (
                <li key={c.name}>
                  <a
                    href={`/city/${encodeURIComponent(c.name)}/`}
                    className="text-body text-primary hover:underline focus-mark"
                  >
                    {c.name}
                  </a>
                  {c.running ? null : (
                    <span className="ml-2 text-label text-fg-muted">· stopped</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <NoCitiesBody />
        )}
      </section>
    </BootstrapShell>
  );
}

function NoCitiesScreen() {
  return (
    <BootstrapShell>
      <section className="space-y-4">
        <h1 className="text-headline font-semibold text-fg">
          No cities are registered on this supervisor.
        </h1>
        <NoCitiesBody />
      </section>
    </BootstrapShell>
  );
}

// Shared actionable empty-state copy: the concrete command that registers a
// first city plus the getting-started link. `gc init` bootstraps the city
// directory AND registers it with the supervisor (verified against
// cmd/gc/cmd_init.go and docs/getting-started/quickstart.md).
function NoCitiesBody() {
  return (
    <div className="space-y-3">
      <p className="text-body text-fg-muted">Create one from a terminal:</p>
      <pre className="overflow-x-auto rounded bg-surface-tint px-3 py-2 font-mono text-[0.8125rem]">
        <code>gc init ~/my-city</code>
      </pre>
      <p className="text-body text-fg-muted">
        <code>gc init</code> bootstraps the city directory, registers it with the supervisor, and
        starts the orchestrator. Then refresh this page. See the{' '}
        <ExternalLink href={GETTING_STARTED_URL} className="text-primary hover:underline focus-mark">
          getting-started guide
        </ExternalLink>{' '}
        for the full walkthrough.
      </p>
    </div>
  );
}

function CitiesErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <BootstrapShell>
      <section role="alert" className="space-y-4">
        <h1 className="text-headline font-semibold text-fg">Could not load cities.</h1>
        <p className="text-body text-fg-muted">{message}</p>
        <Button tone="accent" onClick={onRetry}>
          Retry
        </Button>
      </section>
    </BootstrapShell>
  );
}
