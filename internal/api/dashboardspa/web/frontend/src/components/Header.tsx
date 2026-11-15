import { useMemo } from 'react';
import { NavLink, useLocation } from 'react-router';
import { api } from '../api/client';
import { getActiveCity } from '../api/cityBase';
import { NavAttentionIndicator } from '../attention/NavAttentionIndicator';
import { useAttentionModel } from '../attention/context';
import type { AttentionDomain } from '../attention/compose';
import { useTheme } from '../contexts/ThemeContext';
import { useOperatorConfig } from '../contexts/OperatorConfigContext';
import { ReadOnlyBadge, useReadOnly } from '../contexts/ReadOnlyContext';
import { useViewingAs } from '../contexts/ViewingAsContext';
import { displayLabel } from '../hooks/aliasPriority';
import { useCachedData } from '../hooks/useCachedData';
import { supervisorApi } from '../supervisor/client';
import { ALL_VIEWS } from '../views/registry';
import { filterEnabledViews } from '../views/resolve';
import { Icon, type IconName } from './icons';
import { StatusBadge } from './StatusBadge';

interface NavRoute {
  to: string;
  label: string;
  end?: boolean;
  order: number;
}

// Hand-maintained routes for the views that PR-A has NOT yet ported to
// the modular registry. Each entry carries an explicit `order` so the
// registry-driven entries (currently /health at 60) interleave cleanly
// here without a separate "where does Health go" decision. PR-B+ will
// move entries out of this list as they land in ALL_VIEWS.
const EXPLICIT_ROUTES: ReadonlyArray<NavRoute> = [
  // gascity-dashboard-kb3: Home is the L0 ambient page at `/`.
  // `end: true` so the NavLink active-state matches `/` exactly
  // (otherwise every nested route would also be 'active').
  { to: '/', label: 'Home', end: true, order: 10 },
  // Signpost order (DESIGN-PLAN R6): Runs first among the work views,
  // because stuck runs are what most often needs the owner.
  { to: '/runs', label: 'Runs', order: 20 },
  { to: '/agents', label: 'Agents', order: 30 },
  { to: '/beads', label: 'Beads', order: 40 },
  { to: '/mail', label: 'Mail', order: 50 },
];

// Three signpost groups, split by order: Home | the work (Runs, Agents,
// Beads, Mail) | the record (Activity 55, Health 60). Rules between the
// groups, no captions.
function navGroups(routes: ReadonlyArray<NavRoute>): ReadonlyArray<ReadonlyArray<NavRoute>> {
  return [
    routes.filter((r) => r.order < 20),
    routes.filter((r) => r.order >= 20 && r.order < 55),
    routes.filter((r) => r.order >= 55),
  ].filter((group) => group.length > 0);
}

const NAV_ICONS: Readonly<Record<string, IconName>> = {
  '/': 'home',
  '/runs': 'runs',
  '/agents': 'agents',
  '/beads': 'beads',
  '/mail': 'mail',
  '/activity': 'activity',
  '/health': 'health',
};

const NAV_ATTENTION_DOMAINS: Readonly<Record<string, AttentionDomain>> = {
  '/agents': 'agents',
  '/beads': 'beads',
  '/runs': 'runs',
  '/mail': 'mail',
  '/activity': 'activity',
  '/health': 'health',
};

// The header is the left rail (DESIGN-PLAN §6.1): wordmark and city, the
// app's only <nav> as three signpost groups with signal count pills, then
// the reading-as line, the read-only badge and the theme toggle. Below
// `lg` it folds into a top bar whose nav is one horizontally scrolling
// row, so it never wraps and never widens the page. No hamburger, no state.
export function Header() {
  const { resolved, toggle } = useTheme();
  const { viewingAs } = useViewingAs();
  const { operatorAlias } = useOperatorConfig();
  const readOnly = useReadOnly();
  const attention = useAttentionModel();
  const { data: config } = useCachedData('config', () => api.config());
  // City switcher source (gascity-dashboard-ucc). Lists every managed city;
  // selecting one navigates (full reload) to that city's `/city/:name/`
  // basename so the app remounts with the new active city. A bare full
  // navigation — not client-side — keeps the active-city base, router
  // basename, and every city-scoped fetch consistent without a per-fetch
  // city argument.
  const { data: cities } = useCachedData('cities', () => supervisorApi().listCities());
  const activeCity = getActiveCity();
  const cityItems = cities?.items ?? [];
  // The selected option value. Prefer the URL-derived active city, then the
  // backend's reported city, so the switcher never renders blank.
  const selectedCity = activeCity ?? config?.cityName ?? '';
  // True once the list has loaded and the selected city is a member. While the
  // list is empty (pre-load or a transient fetch blip) we do NOT flag the city
  // as unknown — only a loaded list that omits it is a real miss.
  const activeCityKnown = selectedCity === '' || cityItems.some((c) => c.name === selectedCity);
  // Show the switcher whenever there's a choice to make, or when the selected
  // city is unknown — in the latter case the disabled "(unknown)" option keeps
  // the stale city visible instead of an empty select.
  const showSwitcher = cityItems.length > 1 || !activeCityKnown;
  const onSwitchCity = (next: string): void => {
    if (next === activeCity) return;
    window.location.assign(`/city/${encodeURIComponent(next)}/`);
  };
  // PR-C: filter the registry views by the backend-advertised
  // enabledModules so a disabled module's nav entry disappears in lockstep
  // with its route. While the config fetch is in flight `enabledModules`
  // is null — meaning every firstParty view appears, matching the
  // first-paint route tree in App.tsx.
  const ROUTES: ReadonlyArray<NavRoute> = useMemo(() => {
    const enabled = filterEnabledViews(ALL_VIEWS, config?.enabledModules ?? null);
    const registry: NavRoute[] = enabled.flatMap((v) =>
      v.nav === null
        ? []
        : [{ to: v.path, label: v.nav.label, end: v.path === '/', order: v.nav.order }],
    );
    // Spread already allocates a new mutable array, so .sort() in-place is
    // safe — no .slice() needed (PR-A Phase-4 TS M4).
    return [...EXPLICIT_ROUTES, ...registry].sort((a, b) => a.order - b.order);
  }, [config?.enabledModules]);
  const { pathname } = useLocation();
  // "Reading as" is a Mail-only concept — the value persists across views
  // (for AgentDetail's chat filter) but the header indicator only makes
  // sense inside the mail surface.
  const showReadingAs = !viewingAs.isOperator && pathname.startsWith('/mail');

  const groups = navGroups(ROUTES);

  return (
    <header className="border-b border-rule bg-surface-raised lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-b-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 pb-2 pt-3 sm:px-6 lg:flex lg:min-h-full lg:flex-col lg:items-stretch lg:gap-y-5 lg:px-3 lg:py-5">
        <div className="flex min-w-0 items-center gap-x-3 lg:flex-col lg:items-start lg:gap-y-1 lg:px-2.5">
          <span className="flex shrink-0 items-center gap-2 text-title font-semibold text-fg">
            <Icon name="flame" className="h-5 w-5" />
            gas city
          </span>
          {showSwitcher ? (
            <label className="sr-only" htmlFor="city-switcher">
              Switch city
            </label>
          ) : null}
          {showSwitcher ? (
            <select
              id="city-switcher"
              value={selectedCity}
              onChange={(e) => onSwitchCity(e.target.value)}
              className="-ml-1 min-w-0 max-w-full cursor-pointer truncate rounded border-0 bg-transparent px-1 py-0.5 text-label font-medium text-fg-muted transition-colors duration-150 ease-out-quart hover:text-fg focus-mark"
            >
              {/* A grammar-valid but unregistered/renamed city in the URL is not
                  a list member; without this the select would render blank and
                  the operator couldn't tell which (stale) city they're on. The
                  disabled option keeps it visible without making it selectable
                  (gascity-dashboard-ux-stale-city-url-no-recovery). */}
              {!activeCityKnown && selectedCity !== '' ? (
                <option value={selectedCity} disabled>
                  {selectedCity} (unknown)
                </option>
              ) : null}
              {cityItems.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                  {c.running ? '' : ' (stopped)'}
                </option>
              ))}
            </select>
          ) : (
            <span className="min-w-0 truncate text-label font-medium text-fg-muted">
              {selectedCity || 'city'}
            </span>
          )}
        </div>

        <nav className="col-span-2 -mx-4 flex min-w-0 items-center overflow-x-auto whitespace-nowrap px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:block lg:overflow-visible lg:px-0">
          {groups.map((group, index) => (
            <ul
              key={group[0]?.to ?? index}
              className={`flex shrink-0 items-center gap-0.5 lg:flex-col lg:items-stretch ${
                index > 0
                  ? 'ml-1.5 border-l border-rule pl-1.5 lg:ml-0 lg:mt-2 lg:border-l-0 lg:border-t lg:pl-0 lg:pt-2'
                  : ''
              }`}
            >
              {group.map((r) => {
                const domain = NAV_ATTENTION_DOMAINS[r.to];
                const icon = NAV_ICONS[r.to];
                return (
                  <li key={r.to}>
                    <NavLink
                      to={r.to}
                      end={r.end ?? false}
                      className={({ isActive }) =>
                        [
                          'group flex h-10 items-center gap-2.5 rounded-md px-2.5 text-body transition-colors duration-150 ease-out-quart focus-mark',
                          isActive
                            ? 'bg-surface-tint font-semibold text-fg'
                            : 'font-medium text-fg-muted hover:bg-surface-tint/60 hover:text-fg',
                        ].join(' ')
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {icon !== undefined && (
                            <Icon
                              name={icon}
                              className={
                                isActive
                                  ? 'text-primary'
                                  : 'text-fg-faint group-hover:text-fg-muted'
                              }
                            />
                          )}
                          {r.label}
                          {domain !== undefined && (
                            <NavAttentionIndicator
                              label={r.label}
                              summary={attention.byDomain[domain]}
                            />
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          ))}
        </nav>

        {showReadingAs && (
          <p className="col-span-2 text-label lg:px-2.5">
            <StatusBadge
              tone="warn"
              variant="inline"
              label={`Reading as ${displayLabel(viewingAs.alias, operatorAlias)}`}
            />
          </p>
        )}

        <div className="col-start-2 row-start-1 flex items-center gap-2 lg:mt-auto lg:flex-col lg:items-start lg:gap-3 lg:px-1">
          {readOnly && (
            <span className="lg:px-1.5">
              <ReadOnlyBadge />
            </span>
          )}
          <button
            type="button"
            onClick={toggle}
            aria-label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`}
            className="inline-flex h-8 items-center gap-2 rounded px-1.5 text-label font-medium text-fg-muted transition-colors duration-150 ease-out-quart hover:bg-surface-tint hover:text-fg focus-mark"
          >
            <Icon name={resolved === 'dark' ? 'sun' : 'moon'} className="h-[18px] w-[18px]" />
            {resolved === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>
      </div>
    </header>
  );
}
