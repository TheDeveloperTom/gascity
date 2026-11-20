import {
  Suspense,
  lazy,
  useMemo,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router';
import { api } from './api/client';
import { AttentionProvider } from './attention/context';
import {
  type OperatorConfigState,
  useLiveAttentionContributors,
} from './attention/liveContributors';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { NowProvider } from './contexts/NowContext';
import {
  OperatorConfigProvider,
  resolveOperatorConfig,
  type OperatorConfig,
} from './contexts/OperatorConfigContext';
import { ReadOnlyProvider, resolveReadOnly } from './contexts/ReadOnlyContext';
import { ViewingAsProvider } from './contexts/ViewingAsContext';
import { useCachedData } from './hooks/useCachedData';
import { RunSummaryProvider, useRunSummary } from './runs/runSummarySubscription';
import { ALL_VIEWS } from './views/registry';
import { filterEnabledViews, resolveDefaultViewWithLogging } from './views/resolve';
import type { FrontendViewDescriptor } from './views/types';
import { CommandBar } from './vk/CommandBar';
import { isEmbedded } from './embed/mode';
import { EmbedLaunchOpener } from './embed/EmbedLaunchOpener';
import { EmbedNoAccess } from './embed/EmbedNoAccess';
import { t } from './i18n';

const AgentsPage = lazy(() => import('./routes/Agents').then((m) => ({ default: m.AgentsPage })));
const AgentDetailPage = lazy(() =>
  import('./routes/AgentDetail').then((m) => ({ default: m.AgentDetailPage })),
);
const CockpitHomePage = lazy(() =>
  import('./routes/CockpitHome').then((m) => ({ default: m.CockpitHomePage })),
);
const BeadsPage = lazy(() => import('./routes/Beads').then((m) => ({ default: m.BeadsPage })));
const MailPage = lazy(() => import('./routes/Mail').then((m) => ({ default: m.MailPage })));
const FormulaRunDetailPage = lazy(() =>
  import('./routes/FormulaRunDetail').then((m) => ({ default: m.FormulaRunDetailPage })),
);
const RunsPage = lazy(() => import('./routes/Runs').then((m) => ({ default: m.RunsPage })));

export function App() {
  // NowProvider lives at the App root because useFaviconSignal (R8) is
  // mounted inside the L0 ambient home but the favicon swap must persist
  // across routes — a future refactor that mounts the signal on every
  // route stays straightforward because the 1s tick is already global.

  // PR-C: the backend's /api/config carries the operator's MODULES_ENABLED
  // intersection and the DEFAULT_VIEW env value. While the request is in
  // flight `data` is undefined; we treat that as core-only, matching the
  // steady-state default install and preventing disabled first-party modules
  // from flashing or fetching before config lands.
  const { data: config, error: configError } = useCachedData('config', () => api.config());
  const enabledModules = config?.enabledModules ?? null;
  const defaultViewEnv = config?.defaultView ?? null;
  // Read-only posture is fail-closed on a config-fetch error and writable only
  // while the first fetch is in flight — see resolveReadOnly. The server proxy
  // gate stays the real enforcement throughout.
  // Discord mode is read-only (v1): every write control renders disabled.
  const readOnly = isEmbedded() || resolveReadOnly(config, configError);
  // Operator identity from /config (gascity-dashboard-bhvn). Resolved once and
  // shared by the AttentionRoot (which computes contributors under the
  // RunSummaryProvider) and the OperatorConfigProvider below.
  const operator = resolveOperatorConfig(config);
  // Owner readiness waits for the real identity (review I2): until /config
  // lands, the reads run under the neutral fallback.
  const configState: OperatorConfigState =
    config !== undefined ? 'ready' : configError !== null ? 'failed' : 'loading';

  const enabledViews = useMemo(
    () => filterEnabledViews(ALL_VIEWS, enabledModules),
    [enabledModules],
  );
  const defaultResolution = useMemo(
    () => resolveDefaultViewWithLogging(enabledViews, defaultViewEnv),
    [enabledViews, defaultViewEnv],
  );
  const DefaultViewElement = defaultResolution.view?.element ?? null;
  // dw8 — when `DEFAULT_VIEW` resolves to a view alias (e.g. `needs-you`),
  // the resolver returns no `view` but a `redirectTo` path. Render
  // `<Navigate replace>` at `/` so the URL bar shows the parametrised
  // path the operator is actually viewing; `replace` keeps the back
  // button pointing at wherever the operator came from, not at the
  // resolved alias hop.
  const defaultRedirectTo = defaultResolution.redirectTo ?? null;

  const tree = (
    <OperatorConfigProvider operator={operator}>
      <ViewingAsProvider>
        <NowProvider>
          <ReadOnlyProvider readOnly={readOnly}>
            <RunSummaryProvider>
              <AttentionRoot operator={operator} configState={configState}>
                <Layout>
                  {configError !== null && <ConfigErrorBanner message={configError} />}
                  <RoutedMain
                    defaultRedirectTo={defaultRedirectTo}
                    DefaultViewElement={DefaultViewElement}
                    enabledViews={enabledViews}
                  />
                </Layout>
                {/* vk lane 5: the ⌘K palette, mounted once inside the router.
                    Not in Discord mode: it reaches routes the Activity does not serve. */}
                {!isEmbedded() && <CommandBar />}
                {/* Discord mode: open the card or graph the owner tapped for. */}
                {isEmbedded() && <EmbedLaunchOpener />}
              </AttentionRoot>
            </RunSummaryProvider>
          </ReadOnlyProvider>
        </NowProvider>
      </ViewingAsProvider>
    </OperatorConfigProvider>
  );
  // Discord mode: a refused re-sign-in replaces the board with «Нет доступа».
  return isEmbedded() ? <EmbedNoAccess>{tree}</EmbedNoAccess> : tree;
}

/**
 * Compute the live attention contributors under the RunSummaryProvider so the
 * Runs badge reads the same shared run-summary source the /runs page renders
 * (gascity-dashboard-2j8e.7), then expose the composed model to the tree.
 */
function AttentionRoot({
  operator,
  configState,
  children,
}: {
  operator: OperatorConfig;
  configState: OperatorConfigState;
  children: ReactNode;
}) {
  const { source, sseState } = useRunSummary();
  const { contributors, ownerReadiness, cityReadiness, beadSnapshot } =
    useLiveAttentionContributors(operator, source, { configState, liveFeed: sseState });
  return (
    <AttentionProvider
      contributors={contributors}
      ownerReadiness={ownerReadiness}
      cityReadiness={cityReadiness}
      {...(beadSnapshot === undefined ? {} : { beadSnapshot })}
    >
      {children}
    </AttentionProvider>
  );
}

/**
 * The routed main column, wrapped in an inner ErrorBoundary so a crashed route
 * degrades in place while the Header, nav, and city-switcher stay live
 * (gascity-dashboard-ux-no-per-route-error-boundary). The root boundary in
 * main.tsx remains the last-resort catch-all. The boundary's `key` is tied to
 * the location pathname so navigating away from a crashed route remounts a
 * fresh boundary instead of leaving the operator stuck on the fallback.
 */
function RoutedMain({
  defaultRedirectTo,
  DefaultViewElement,
  enabledViews,
}: {
  defaultRedirectTo: string | null;
  DefaultViewElement: LazyExoticComponent<ComponentType> | null;
  enabledViews: ReadonlyArray<FrontendViewDescriptor>;
}) {
  const { pathname } = useLocation();
  if (isEmbedded()) {
    // Discord mode (review L1): the board with its card and graph is the
    // only view; every other path goes back to it, keeping the query. The
    // other views read and stream what the Activity gateway does not serve.
    return (
      <ErrorBoundary key={pathname}>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/beads" element={<BeadsPage />} />
            <Route path="*" element={<EmbedHome />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    );
  }
  return (
    <ErrorBoundary key={pathname}>
      <Suspense fallback={null}>
        <Routes>
          {/* `/` resolution (PRD §6 / bead 9yj.5):
              DEFAULT_VIEW env → descriptor `defaultRoute: true` →
              live cockpit home fallback. The resolver runs once per
              enabled-set / env change; warnings surface in the
              browser console for premortem #5 visibility. */}
          <Route
            path="/"
            element={
              defaultRedirectTo !== null ? (
                <Navigate to={defaultRedirectTo} replace />
              ) : DefaultViewElement !== null ? (
                <DefaultViewElement />
              ) : (
                <CockpitHomePage />
              )
            }
          />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/:slug" element={<AgentDetailPage />} />
          <Route path="/beads" element={<BeadsPage />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/runs/:runId" element={<FormulaRunDetailPage />} />
          <Route path="/mail" element={<MailPage />} />
          {/* Modular-dashboard registry routes, filtered by the
              backend's enabledModules set. A disabled module's path
              is absent so deep-link bookmarks surface the operator's
              MODULES_ENABLED change as the explicit catch-all route. */}
          {enabledViews.map((v) => {
            const Element = v.element;
            return <Route key={v.id} path={v.path} element={<Element />} />;
          })}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

/**
 * Top-of-app banner for a failed `/config` fetch. Read-only posture already
 * fails closed on this error (resolveReadOnly), but the operator should also
 * see WHY the dashboard is degraded rather than guessing from disabled
 * controls. Rendered inside the main column so the Header and nav stay live.
 */
function ConfigErrorBanner({ message }: { message: string }) {
  return (
    <section
      role="alert"
      className="mb-6 rounded-md border border-warn/50 bg-surface-raised px-3 py-2 text-body text-fg"
    >
      <span className="font-semibold text-warn">{t('config unavailable:')}</span> {message} ·{' '}
      {t('some controls may be disabled until it loads.')}
    </section>
  );
}

/** Discord mode's every other path: the board, keeping the query (the Activity's launch params). */
function EmbedHome() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/beads', search }} replace />;
}

function NotFoundPage() {
  return (
    <section
      aria-labelledby="not-found-title"
      className="mx-auto mt-6 max-w-[40rem] space-y-2 rounded-lg border border-rule bg-surface-raised p-6"
    >
      <h1 id="not-found-title" className="text-headline font-semibold text-fg">
        {t('Page not found')}
      </h1>
      <p className="text-body text-fg-muted">{t('No dashboard route matches this path.')}</p>
    </section>
  );
}
