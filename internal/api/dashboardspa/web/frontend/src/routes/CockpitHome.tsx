import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type {
  ListBodySessionResponse,
  RunsCensusOutputBody,
  StatusBody,
  UsageBody,
  UsageTotals,
} from 'gas-city-dashboard-shared/gc-supervisor';
import { activeCityOrThrow, getActiveCity } from '../api/cityBase';
import type { AttentionItem } from '../attention/compose';
import { useAttentionModel } from '../attention/context';
import {
  ActivityTrace,
  ContextMeters,
  Gauge,
  InstrumentNote,
  Odometer,
  PipelineBar,
  StatTile,
} from '../components/cockpit/Instruments';
import { burnPerHour, pipelineSegments, tokensPerMinute } from '../components/cockpit/model';
import { Button } from '../components/Button';
import { CityStrip, type CityAgents } from '../components/home/CityStrip';
import { ownQuestionIdsOf, useNeedsModel } from '../lib/needsFromMe';
import { topicNeedsOf } from '../lib/peerTopics';
import { peerNeedsCount, pendingTopicQuestions } from '../lib/topicQuestions';
import { useCappedHold } from '../hooks/useCappedHold';
import { PEER_SETTLE_CAP_MS, usePeerBoards, usePeerBoardsSettled } from '../hooks/usePeerBoards';
import { NeedsSection } from '../vk/needs/NeedsSection';
import { StatusShape } from '../components/icons';
import { PageHeader } from '../components/PageHeader';
import { useCachedData } from '../hooks/useCachedData';
import { useTaskStages } from '../hooks/useTaskStages';
import { t } from '../i18n';
import { SUPERVISOR_REQUEST_TIMEOUT_MS, supervisorApi } from '../supervisor/client';

const POLL_MS = 15_000;
const NO_UNREAD: readonly string[] = [];
const MAX_TRACE_SAMPLES = 48;
const SECONDS_PER_DAY = 86_400;

export function CockpitHomePage() {
  const city = getActiveCity();
  const cityKey = city ?? 'no-city';
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const usageState = useCachedData<UsageBody>(`cockpit:usage:${cityKey}`, () =>
    supervisorApi().cityUsage(activeCityOrThrow('cockpit usage read')),
  );
  const statusState = useCachedData<StatusBody>(`cockpit:status:${cityKey}`, () =>
    supervisorApi().cityStatus(activeCityOrThrow('cockpit status read')),
  );
  const runsState = useCachedData<RunsCensusOutputBody>(`cockpit:runs:${cityKey}`, () =>
    supervisorApi().runCensus(activeCityOrThrow('cockpit run census read')),
  );
  const sessionsState = useCachedData<ListBodySessionResponse>(`cockpit:sessions:${cityKey}`, () =>
    supervisorApi().listSessions(activeCityOrThrow('cockpit sessions read')),
  );
  const attention = useAttentionModel();
  const taskStages = useTaskStages();
  const needs = useNeedsModel();
  // vk-final part 4: Mayor topics that need the owner or have unread messages.
  const peerBoards = usePeerBoards();
  // H1 16.11: the Mayors' questions land with the peer boards; hold the lower
  // part of the page until they have answered once (capped), so it never jumps.
  const peerSettled = usePeerBoardsSettled(PEER_SETTLE_CAP_MS);
  // Review I-1: capped, so a board read that never answers cannot hide «Город»
  // and the instruments.
  const holding = useCappedHold(needs.state === 'loading' || !peerSettled, PEER_SETTLE_CAP_MS);
  const topicNeeds = useMemo(() => topicNeedsOf(peerBoards.result, Date.now()), [peerBoards.result]);
  // BOARD-LIVE L7: the owner's plain topic questions, each counted once
  const ownQuestionIds = useMemo(() => ownQuestionIdsOf(needs), [needs]);
  const topicQuestions = useMemo(
    () => pendingTopicQuestions(peerBoards.result, ownQuestionIds),
    [peerBoards.result, ownQuestionIds],
  );
  const peerCount = useMemo(
    () => peerNeedsCount(peerBoards.result, ownQuestionIds, Date.now()),
    [peerBoards.result, ownQuestionIds],
  );

  usePoll(usageState.refresh, usageState.loading, pausedRef);
  usePoll(statusState.refresh, statusState.loading, pausedRef);
  usePoll(runsState.refresh, runsState.loading, pausedRef);
  usePoll(sessionsState.refresh, sessionsState.loading, pausedRef);

  const usageReading = useFrozenWhilePaused(useReadingSnapshot(usageState, cityKey), paused);
  const statusReading = useFrozenWhilePaused(useReadingSnapshot(statusState, cityKey), paused);
  const runsReading = useFrozenWhilePaused(useReadingSnapshot(runsState, cityKey), paused);
  const sessionsReading = useFrozenWhilePaused(useReadingSnapshot(sessionsState, cityKey), paused);

  const usage = usageReading.data;
  const status = statusReading.data;
  const canonicalRuns = runsReading.data;
  const sessions = sessionsReading.data;

  const [activitySamples, setActivitySamples] = useState<number[]>([]);
  const lastUsageSampleRef = useRef<string | null>(null);
  useEffect(() => {
    if (paused || usage === undefined || !usage.available) return;
    if (lastUsageSampleRef.current === usage.updated_at) return;
    lastUsageSampleRef.current = usage.updated_at;
    const next = Math.max(0, usage.recent.invocations);
    setActivitySamples((previous) => [...previous, next].slice(-MAX_TRACE_SAMPLES));
  }, [paused, usage]);

  const usageAvailable = usage?.available === true;
  // last_24h is optional on the wire: a server or public-front proxy that
  // predates the field omits it, so every read must treat it as possibly absent.
  const last24h = usage?.last_24h;
  const usageDomainNote =
    usage === undefined
      ? undefined
      : [
          !usage.available ? t('usage recording is not local') : undefined,
          usage.available && !usage.recording ? t('usage recording is off') : undefined,
          usage.partial
            ? usage.partial_reasons?.join(' · ') || t('usage estimate is partial')
            : undefined,
          usage.today.unpriced > 0 ||
          usage.recent.unpriced > 0 ||
          (usage.last_24h?.unpriced ?? 0) > 0
            ? 'cost excludes unpriced model calls'
            : undefined,
        ]
          .filter((note): note is string => note !== undefined)
          .join(' · ') || undefined;
  // Model facts mint in a burst when a session retires (the end-of-interval
  // sweep), so the live 5-minute window is empty on a busy pipeline almost all
  // the time. Drive the rate dials off whichever window actually has model
  // activity: the live window when it does, else the rolling 24h average. With
  // neither, the dials read unavailable — a structural zero would render as a
  // real "0 / min", which it is not.
  const rateWindow: { totals: UsageTotals; seconds: number; basis?: string } | null =
    !usageAvailable
      ? null
      : usage.recent.invocations > 0
        ? { totals: usage.recent, seconds: usage.recent_window_secs }
        : last24h !== undefined && last24h.invocations > 0
          ? { totals: last24h, seconds: SECONDS_PER_DAY, basis: t('24 h average') }
          : null;
  const recentTokens = rateWindow ? tokensPerMinute(rateWindow.totals, rateWindow.seconds) : null;
  const recentBurn = rateWindow ? burnPerHour(rateWindow.totals, rateWindow.seconds) : null;
  const activeSessionsFromStatus = status?.session_counts_detail?.active;
  const activeSessions =
    activeSessionsFromStatus ??
    (sessions === undefined
      ? null
      : (sessions.items ?? []).filter((session) => session.running).length);
  const segments = useMemo(
    () => pipelineSegments(canonicalRuns?.status_counts ?? null),
    [canonicalRuns?.status_counts],
  );
  const contextMeters = useMemo(
    () =>
      (sessions?.items ?? [])
        .filter(
          (session) =>
            session.running &&
            typeof session.context_pct === 'number' &&
            Number.isFinite(session.context_pct),
        )
        .sort((a, b) => (b.context_pct ?? 0) - (a.context_pct ?? 0))
        .slice(0, 8)
        .map((session) => ({
          id: session.id,
          label: session.title || session.session_name || session.template,
          value: session.context_pct ?? 0,
          href: '/agents',
        })),
    [sessions?.items],
  );
  const statusStale = status !== undefined && statusReading.stale;
  const statusPartial = status?.partial === true;
  const statusProvenance = statusStale ? 'stale' : statusPartial ? 'partial' : null;
  // HO-11 superseded: the systems lamps live on as city problems in the
  // attention model (review I-4), so Home, the rail and Health count one
  // slice. An unread or stale status is listed here as unreadable, never as
  // healthy and never as a zero.
  const statusUnreadable: AttentionItem | null =
    status === undefined
      ? statusReading.loading
        ? null
        : unreadableItem('status-unavailable', t('City status'))
      : statusProvenance === null
        ? null
        : unreadableItem(
            'status-provenance',
            statusProvenance === 'stale' ? t('City status is stale') : t('City status is partial'),
          );
  const cityIssues = useMemo(
    () => attention.city.items.filter((item) => item.severity !== 'unavailable'),
    [attention.city.items],
  );
  // REVIEW Round 2: a rig store the board could not read may hold a question
  // for the owner; say so here instead of showing a shorter shelf.
  const needsUnread = needs.unread ?? NO_UNREAD;
  const storesUnreadable = useMemo<AttentionItem | null>(
    () =>
      needsUnread.length === 0
        ? null
        : unreadableItem(
            'rig-stores-unread',
            needsUnread.includes('*')
              ? t('Project list')
              : t('Project tasks ({names})', { names: needsUnread.join(', ') }),
          ),
    [needsUnread],
  );
  const cityUnreadable = useMemo(
    () => [
      ...(statusUnreadable === null ? [] : [statusUnreadable]),
      ...(storesUnreadable === null ? [] : [storesUnreadable]),
      ...attention.city.items.filter((item) => item.severity === 'unavailable'),
    ],
    [attention.city.items, statusUnreadable, storesUnreadable],
  );
  const cityAgents: CityAgents =
    status === undefined
      ? statusReading.loading
        ? 'loading'
        : 'unavailable'
      : { running: status.agents.running, total: status.agents.total };

  const usageNote = readingNote(usageReading, 'usage', usageDomainNote);
  // Rate dials say which window they read so a 24h-average fallback never
  // masquerades as a live-window rate.
  // The usage note itself shows once per section (the odometer under Right
  // now, the 24 h tiles under Usage), not again under every dial.
  const rateNote = rateWindow?.basis;
  const statusNote = readingNote(
    statusReading,
    'city status',
    status?.partial ? t('city status is partial') : undefined,
  );
  const runsNote = readingNote(
    runsReading,
    'run states',
    canonicalRuns?.partial ? t('run projection is partial') : undefined,
  );
  const sessionsNote = readingNote(
    sessionsReading,
    'sessions',
    sessions?.partial ? t('session list is partial') : undefined,
  );
  const activeSessionsNote = activeSessionsFromStatus === undefined ? sessionsNote : statusNote;
  // One honest line inside the usage section naming every reading that has no
  // data and is not loading, so the dashes there are explained.
  const unavailableReadings = (
    [
      { name: 'usage', reading: usageReading },
      { name: 'city status', reading: statusReading },
      { name: 'run states', reading: runsReading },
      { name: 'sessions', reading: sessionsReading },
    ] as const
  )
    .filter(({ reading }) => reading.data === undefined && !reading.loading)
    .map(({ name }) => name);

  // R9: the owner's Home is three blocks; the instruments fold into one
  // closed «Расход и нагрузка», unchanged inside (test ids, notes, names).
  return (
    <section>
      {/* vk-final: the shelf below already reads «Нужно от меня» with its
          count, so the page title stays for screen readers only. */}
      <PageHeader title={t('Needs from me')} className="sr-only" />

      {/* vk lane 3: «Нужно от меня», «Работает», «Тихо» (Attention / Phone-Needs). */}
      <div className="mb-10 min-w-0">
        <NeedsSection
          model={needs}
          stages={taskStages}
          topicNeeds={topicNeeds}
          topicQuestions={topicQuestions}
          peerCount={peerCount}
          settling={holding}
        />
      </div>

      {/* H1 16.11: below the shelves only once the board and the peer boards are read (no layout shift). */}
      {!holding && (
      <>
      <CityStrip
        agents={cityAgents}
        tasks={taskStages}
        issues={cityIssues}
        unreadable={cityUnreadable}
        readiness={attention.cityReadiness}
      />

      <details className="group border-t border-rule pt-3">
        <summary className="focus-mark cursor-pointer select-none py-2 text-title font-semibold text-fg">
          {t('Usage and load')}
        </summary>
        <div className="pt-4">
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              aria-pressed={paused}
              onClick={() => setPaused((current) => !current)}
            >
              {paused ? t('Resume updates') : t('Pause updates')}
            </Button>
            {unavailableReadings.length > 0 && (
              <p role="status" className="flex items-center gap-2 text-label text-warn">
                <StatusShape tone="warn" />
                <span>{t('Some readings are unavailable: {list}.', { list: unavailableReadings.map((name) => t(name)).join(', ') })}</span>
              </p>
            )}
          </div>

          <section aria-labelledby="run-state-title" className="mb-10">
            <h3 id="run-state-title" className="mb-3 text-label font-medium text-fg-muted">
              {t('Runs by state')}
            </h3>
            <PipelineBar segments={segments} available={canonicalRuns !== undefined} />
            {runsNote && <InstrumentNote>{runsNote}</InstrumentNote>}
          </section>

          <section aria-labelledby="right-now-title" className="mb-10">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 id="right-now-title" className="text-title font-semibold text-fg">
                {t('Right now')}
              </h2>
            </div>
            <div
              className="grid items-start gap-x-8 gap-y-6 [grid-template-columns:repeat(auto-fit,minmax(10rem,1fr))]"
              data-testid="dial-grid"
            >
              <Odometer
                label={t('model calls today')}
                value={usageAvailable ? usage.today.invocations : null}
                note={
                  usageAvailable
                    ? [t('{cost} estimated today', { cost: formatUsd(usage.today.cost_usd_estimate) }), usageNote]
                        .filter((note): note is string => note !== undefined)
                        .join(' · ')
                    : usageNote
                }
              />
              <Gauge
                label={t('active sessions')}
                value={activeSessions}
                max={Math.max(10, (activeSessions ?? 0) * 1.25)}
                formatted={formatCount(activeSessions)}
                href="/agents"
                note={activeSessionsNote}
              />
              <Gauge
                label={t('tokens / min')}
                value={recentTokens}
                max={Math.max(1_000, (recentTokens ?? 0) * 1.25)}
                formatted={recentTokens === null ? '—' : formatCompact(recentTokens)}
                href="/activity"
                note={rateNote}
              />
              <Gauge
                label={t('burn · $ / hr')}
                value={recentBurn}
                max={Math.max(10, (recentBurn ?? 0) * 1.25)}
                formatted={recentBurn === null ? '—' : formatUsd(recentBurn)}
                href="/activity"
                note={rateNote}
              />
            </div>
          </section>

          <section aria-labelledby="usage-title">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 id="usage-title" className="text-title font-semibold text-fg">
                {t('Usage')}
              </h2>
            </div>
            <section className="mb-8" aria-labelledby="last24h-title">
              <h3 id="last24h-title" className="mb-2 text-label font-medium text-fg-muted">
                {t('Last 24 hours')}
              </h3>
              <div
                className="grid items-start gap-x-8 gap-y-4 [grid-template-columns:repeat(auto-fit,minmax(8rem,1fr))]"
                data-testid="last24h-grid"
              >
                <StatTile
                  label={t('tokens in')}
                  value={
                    usageAvailable && last24h !== undefined
                      ? formatCompact(last24h.input_tokens)
                      : null
                  }
                />
                <StatTile
                  label={t('tokens out')}
                  value={
                    usageAvailable && last24h !== undefined
                      ? formatCompact(last24h.output_tokens)
                      : null
                  }
                />
                <StatTile
                  label={t('model calls')}
                  value={
                    usageAvailable && last24h !== undefined
                      ? formatCount(last24h.invocations)
                      : null
                  }
                />
                <StatTile
                  label={t('est. cost')}
                  value={
                    usageAvailable && last24h !== undefined
                      ? formatUsd(last24h.cost_usd_estimate)
                      : null
                  }
                />
              </div>
              {usageNote && <InstrumentNote>{usageNote}</InstrumentNote>}
            </section>

            <div className="mb-8">
              <ActivityTrace
                samples={activitySamples}
                available={usageAvailable}
                note={
                  usageNote === undefined && activitySamples.length === 0
                    ? t('waiting for the first usage sample')
                    : undefined
                }
              />
            </div>

            <section aria-labelledby="context-title">
              <h3 id="context-title" className="mb-2 text-label font-medium text-fg-muted">
                {t('Context window used')}
              </h3>
              <ContextMeters meters={contextMeters} />
              {(sessionsNote || contextMeters.length === 0) && (
                <InstrumentNote>
                  {sessionsNote ?? t('no live session context reported')}
                </InstrumentNote>
              )}
            </section>
          </section>
        </div>
      </details>
      </>
      )}
    </section>
  );
}

function unreadableItem(id: string, title: string): AttentionItem {
  return { id: `home:${id}`, domain: 'health', severity: 'unavailable', title, href: '/health' };
}

function usePoll(
  refresh: () => Promise<void>,
  loading: boolean,
  pausedRef: MutableRefObject<boolean>,
) {
  useEffect(() => {
    // A fixed interval can supersede every response that takes longer than the
    // cadence because useCachedData publishes only its latest run. Keep one
    // timer instead: poll after settlement, or elect a recovery attempt after
    // the supervisor request budget if a broken fetch never settles.
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function schedule(delay: number) {
      if (stopped) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(run, delay);
    }

    function run() {
      timer = undefined;
      if (pausedRef.current) {
        schedule(POLL_MS);
        return;
      }

      const pending = refresh();
      schedule(SUPERVISOR_REQUEST_TIMEOUT_MS);
      void pending.then(
        () => schedule(POLL_MS),
        () => schedule(POLL_MS),
      );
    }

    schedule(loading ? SUPERVISOR_REQUEST_TIMEOUT_MS : POLL_MS);
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [loading, pausedRef, refresh]);
}

function useFrozenWhilePaused<T>(live: T, paused: boolean): T {
  const valueRef = useRef(live);
  if (!paused) valueRef.current = live;
  return valueRef.current;
}

function useReadingSnapshot<T>(
  state: {
    data: T | undefined;
    loading: boolean;
    error: string | null;
    fetchedAt: string | undefined;
  },
  key: string,
) {
  const failedRef = useRef<{ key: string; data: T; fetchedAt: string | undefined } | null>(null);
  if (failedRef.current?.key !== key) failedRef.current = null;

  if (state.error !== null && state.data !== undefined) {
    failedRef.current = { key, data: state.data, fetchedAt: state.fetchedAt };
  } else if (failedRef.current !== null && !state.loading) {
    failedRef.current = null;
  }

  const failed = failedRef.current;
  return {
    data: failed?.data ?? state.data,
    loading: state.loading,
    fetchedAt: failed?.fetchedAt ?? state.fetchedAt,
    stale: failed !== null,
  };
}

function readingNote<T>(
  state: {
    data: T | undefined;
    loading: boolean;
    fetchedAt: string | undefined;
    stale: boolean;
  },
  label: string,
  domainNote?: string,
): string | undefined {
  if (state.data === undefined) {
    if (state.loading) return t('loading {what}…', { what: t(label) });
    return t('{what} unavailable', { what: t(label) });
  }
  if (state.stale) {
    return t('{what} is stale · refresh failed', { what: t(label) });
  }
  if (domainNote) return domainNote;
  return undefined;
}

function formatCount(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(Math.max(0, Math.round(value)))
    : '—';
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(
    Math.max(0, value),
  );
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Math.max(0, value));
}
