import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
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
import { t } from '../i18n';
import { useLocale } from '../i18n/LocaleProvider';
import { hardNavigate } from '../lib/navigation';
import { supervisorApi } from '../supervisor/client';
import { MoreGlyph } from '../vk/shell/BottomTabs';
import { TopNav } from '../vk/shell/TopNav';
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

// Set by the language toggle just before the remount it causes; the next
// Header mount takes focus back to the toggle and clears it.
let refocusLocaleToggle = false;

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

function hhmm(iso: string | undefined): string | null {
  if (iso === undefined) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Phone tap targets are 44 px; from md the VK bar's 30 px controls.
const BAR_BUTTON =
  'inline-flex h-11 min-w-11 items-center justify-center rounded-[3px] px-1.5 text-label font-medium text-vk-text-low transition-colors duration-150 ease-out-quart hover:bg-vk-bg-panel hover:text-vk-text-high focus-mark md:h-[30px] md:min-w-[30px]';

// The VK top bar (vk lane 5, ruling 4: it replaces the left rail). Left: the
// city mark «DW ГО» and the city switcher, then the section tabs and the ⌘K
// search (TopNav, desktop). Right: «обновлено HH:MM», the «Ещё» menu, which is
// the app's full page list so every debug view stays one click away, the
// read-only badge, theme and language toggles, and the «А» mark. Sticky from
// md; on phones it is a plain row that scrolls away above the page, whose own
// sections live in the bottom tabs.
export function Header() {
  const { resolved, toggle } = useTheme();
  const { locale, setLocale } = useLocale();
  const { viewingAs } = useViewingAs();
  const { operatorAlias } = useOperatorConfig();
  const readOnly = useReadOnly();
  const attention = useAttentionModel();
  const { data: config } = useCachedData('config', () => api.config());
  // City switcher source (gascity-dashboard-ucc). Lists every managed city;
  // selecting one navigates (full reload, through hardNavigate) to that
  // city's `/city/:name/` basename so the app remounts with the new active
  // city and every city-scoped fetch follows.
  const { data: cities, fetchedAt } = useCachedData('cities', () => supervisorApi().listCities());
  const activeCity = getActiveCity();
  const cityItems = cities?.items ?? [];
  // The selected option value. Prefer the URL-derived active city, then the
  // backend's reported city, so the switcher never renders blank.
  const selectedCity = activeCity ?? config?.cityName ?? '';
  // True once the list has loaded and the selected city is a member. While the
  // list is empty (pre-load or a transient fetch blip) we do NOT flag the city
  // as unknown — only a loaded list that omits it is a real miss.
  const activeCityKnown = selectedCity === '' || cityItems.some((c) => c.name === selectedCity);
  const showSwitcher = cityItems.length > 1 || !activeCityKnown;
  const onSwitchCity = (next: string): void => {
    if (next === activeCity) return;
    hardNavigate(`/city/${encodeURIComponent(next)}/`);
  };
  // PR-C: filter the registry views by the backend-advertised
  // enabledModules so a disabled module's nav entry disappears in lockstep
  // with its route. While the config fetch is in flight `enabledModules`
  // is null — meaning every firstParty view appears.
  const ROUTES: ReadonlyArray<NavRoute> = useMemo(() => {
    const enabled = filterEnabledViews(ALL_VIEWS, config?.enabledModules ?? null);
    const registry: NavRoute[] = enabled.flatMap((v) =>
      v.nav === null
        ? []
        : [{ to: v.path, label: v.nav.label, end: v.path === '/', order: v.nav.order }],
    );
    return [...EXPLICIT_ROUTES, ...registry].sort((a, b) => a.order - b.order);
  }, [config?.enabledModules]);
  const { pathname } = useLocation();
  // "Reading as" is a Mail-only concept.
  const showReadingAs = !viewingAs.isOperator && pathname.startsWith('/mail');
  const updated = hhmm(fetchedAt);

  const localeToggleRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!refocusLocaleToggle) return;
    refocusLocaleToggle = false;
    localeToggleRef.current?.focus();
  }, []);

  // The «Ещё» menu is a <details>: no state, keyboard and screen-reader
  // native. It closes whenever the route changes.
  const moreRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (moreRef.current !== null) moreRef.current.open = false;
  }, [pathname]);

  const groups = navGroups(ROUTES);
  const ownerAttention = attention.owner.total;
  return (
    <header className="border-b border-vk-border bg-vk-bg-secondary pl-[var(--sail)] pr-[var(--sair)] pt-[var(--sait)] font-vk-sans md:sticky md:top-0 md:z-30">
      <div className="flex min-h-11 items-center gap-2 px-3 md:gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            title={t('devwork product')}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[4.5px] bg-vk-bg-panel text-[13px] font-medium text-vk-text-high"
          >
            DW
          </span>
          <span
            title={t('The city itself')}
            className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-[4.5px] text-[13px] font-medium text-vk-text-normal sm:inline-flex"
          >
            ГО
          </span>
          {showSwitcher ? (
            <label className="sr-only" htmlFor="city-switcher">
              {t('Switch city')}
            </label>
          ) : null}
          {showSwitcher ? (
            <select
              id="city-switcher"
              value={selectedCity}
              onChange={(e) => onSwitchCity(e.target.value)}
              className="h-11 min-w-0 max-w-[12rem] cursor-pointer truncate rounded-[3px] border-0 bg-transparent px-1 text-[14px] text-vk-text-normal transition-colors duration-150 ease-out-quart hover:text-vk-text-high focus-mark md:h-[30px]"
            >
              {/* A grammar-valid but unregistered/renamed city in the URL is not
                  a list member; the disabled option keeps it visible without
                  making it selectable (gascity-dashboard-ux-stale-city-url-no-recovery). */}
              {!activeCityKnown && selectedCity !== '' ? (
                <option value={selectedCity} disabled>
                  {t('{city} (unknown)', { city: selectedCity })}
                </option>
              ) : null}
              {cityItems.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.running ? c.name : t('{city} (stopped)', { city: c.name })}
                </option>
              ))}
            </select>
          ) : (
            <span className="min-w-0 truncate px-1 text-[14px] text-vk-text-normal">
              {selectedCity || t('city')}
            </span>
          )}
        </div>

        <TopNav />

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {showReadingAs && (
            <span className="hidden text-label md:inline">
              <StatusBadge
                tone="warn"
                variant="inline"
                label={t('Reading as {name}', {
                  name: displayLabel(viewingAs.alias, operatorAlias),
                })}
              />
            </span>
          )}
          {updated !== null && (
            <span className="hidden whitespace-nowrap px-1 text-[13px] text-vk-text-low lg:inline">
              {t('updated {time}', { time: updated })}
            </span>
          )}
          {readOnly && <ReadOnlyBadge />}

          <details ref={moreRef} className="relative">
            <summary
              aria-label={t('More')}
              className={`${BAR_BUTTON} relative cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
            >
              <MoreGlyph size={18} />
              {ownerAttention > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute right-1 top-1.5 h-1.5 w-1.5 rounded-full bg-accent md:top-0.5 md:right-0.5"
                />
              )}
            </summary>
            <nav
              aria-label={t('All pages')}
              className="absolute right-0 top-full z-40 mt-1 w-60 max-w-[calc(100vw-1.5rem)] rounded-[4.5px] border border-vk-border bg-vk-bg-primary p-1 shadow-overlay"
            >
              {groups.map((group, index) => (
                <ul
                  key={group[0]?.to ?? index}
                  className={index > 0 ? 'mt-1 border-t border-vk-border pt-1' : ''}
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
                              'group flex h-11 items-center gap-2.5 rounded-[3px] px-2.5 text-[15px] transition-colors duration-150 ease-out-quart focus-mark md:h-9',
                              isActive
                                ? 'bg-vk-bg-panel text-vk-text-high'
                                : 'text-vk-text-normal hover:bg-vk-bg-panel/60 hover:text-vk-text-high',
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
                                      ? 'text-vk-text-high'
                                      : 'text-vk-text-low group-hover:text-vk-text-normal'
                                  }
                                />
                              )}
                              {t(r.label)}
                              {domain !== undefined && (
                                <NavAttentionIndicator
                                  label={r.label}
                                  ownerCount={attention.owner.byDomain[domain]}
                                  cityCount={domain === 'health' ? attention.city.total : 0}
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
          </details>

          <button
            type="button"
            onClick={toggle}
            aria-label={
              resolved === 'dark' ? t('Switch to light theme') : t('Switch to dark theme')
            }
            className={BAR_BUTTON}
          >
            <Icon name={resolved === 'dark' ? 'sun' : 'moon'} className="h-[17px] w-[17px]" />
          </button>
          {/* Language toggle (SH-18, ruling R2): the label names the language
              it switches TO; the choice persists in gascity:locale. The tree
              remounts on a change, so focus is handed back (review M-5). */}
          <button
            ref={localeToggleRef}
            type="button"
            onClick={() => {
              refocusLocaleToggle = true;
              setLocale(locale === 'ru' ? 'en' : 'ru');
            }}
            aria-label={
              locale === 'ru'
                ? t('Switch language to English (EN)')
                : t('Switch language to Russian (RU)')
            }
            className={`${BAR_BUTTON} font-semibold`}
          >
            {locale === 'ru' ? 'EN' : 'RU'}
          </button>
          <span
            title={t('You')}
            className="ml-1 hidden h-7 w-7 shrink-0 items-center justify-center rounded-full bg-vk-bg-panel text-[13px] font-medium text-vk-text-normal md:inline-flex"
          >
            А
          </span>
        </div>
      </div>
    </header>
  );
}
