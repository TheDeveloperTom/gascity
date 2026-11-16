import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type {
  DoltNomsTrend,
  LiveHealth,
  LocalToolVersions,
  RigStoreHealthReport,
  SupervisorStatusReport,
} from 'gas-city-dashboard-shared';
import type { StatusBody } from 'gas-city-dashboard-shared/gc-supervisor';
import { api } from '../api/client';
import { getActiveCity } from '../api/cityBase';
import { useAttentionModel } from '../attention/context';
import { CityIssues } from '../components/health/CityIssues';
import {
  CityFacts,
  storeAdvisory,
  storeRows,
  type SupervisorState,
} from '../components/health/CityFacts';
import { LiveChart, type ChartSeries } from '../components/health/LiveChart';
import { WhoEatsMac } from '../components/health/WhoEatsMac';
import { useCachedData } from '../hooks/useCachedData';
import { useLiveHealth } from '../hooks/useLiveHealth';
import { useVisibleRefresh } from '../hooks/useVisibleRefresh';
import { t } from '../i18n';
import {
  buildHeadline,
  busyPctOf,
  cpuQueueLine,
  cpuToneOf,
  diskTone,
  formatBytes,
  formatPct,
  HOST_THRESHOLDS,
  memoryTone,
  sustainedBusy,
  type HostTone,
} from '../lib/hostHeadline';
import { LIVE_POLL_MS, windowSamples, type LiveSample } from '../lib/hostLive';
import { supervisorApiForRequestBudget } from '../supervisor/client';

// Health (owner 16.11: «сделай красиво, чтобы было понятно что там происходит
// по нагрузке… риалтайм, чтобы было видно что с маком происходит»). Top to
// bottom: one sentence about the Mac now, three live charts on one shared
// percent scale (CPU, memory, disk), who eats the Mac, then the city's own
// facts kept quiet below. Thresholds live in lib/hostHeadline.ts.

const HEALTH_SUPERVISOR_REQUEST_TIMEOUT_MS = 2_500;
const WINDOWS = [15, 30] as const;
type WindowMinutes = (typeof WINDOWS)[number];

export function HealthPage() {
  const attention = useAttentionModel();
  const cityName = getActiveCity();
  const { latest, error, history, now } = useLiveHealth();
  const [windowMin, setWindowMin] = useState<WindowMinutes>(15);

  const supervisor = useCachedData(`health:supervisor:${cityName ?? 'no-city'}`, fetchSupervisor);
  const status = useCachedData(`health:status:${cityName ?? 'no-city'}`, fetchStatus);
  const tools = useCachedData('health:local-tools', fetchTools);
  const trend = useCachedData(`health:dolt-noms-trend:${cityName ?? 'no-city'}`, fetchTrend);
  const rigStores = useCachedData(`health:rig-store:${cityName ?? 'no-city'}`, fetchRigStores);
  const refreshSupervisor = supervisor.refresh;
  const refreshStatus = status.refresh;
  const refreshTools = tools.refresh;
  const refreshTrend = trend.refresh;
  const refreshRigStores = rigStores.refresh;
  const refreshCity = useCallback(async () => {
    await Promise.all([
      refreshSupervisor(),
      refreshStatus(),
      refreshTools(),
      refreshTrend(),
      refreshRigStores(),
    ]);
  }, [refreshRigStores, refreshStatus, refreshSupervisor, refreshTools, refreshTrend]);
  useVisibleRefresh(refreshCity, 30_000);

  const unreadable = useMemo(
    () => attention.items.filter((item) => item.severity === 'unavailable'),
    [attention.items],
  );

  const statusBody = status.data?.status === 'available' ? status.data.data : null;
  const advisory = storeAdvisory(statusBody?.store_health);
  const edge = Math.max(now, history.at(-1)?.at ?? 0);
  // While the history is younger than the chosen window, zoom to it (at
  // least 3 minutes) so a freshly opened page is not a mostly empty frame.
  const span = edge - (history[0]?.at ?? edge);
  const windowMs = Math.min(
    windowMin * 60_000,
    Math.max(3 * 60_000, Math.ceil(span / 60_000) * 60_000),
  );
  const shown = windowSamples(history, edge, windowMs);
  const sustained = sustainedBusy(history, edge);

  return (
    <section className="space-y-8 pb-10">
      <Verdict
        live={latest}
        sustained={sustained}
        error={error}
        windowMin={windowMin}
        onWindow={setWindowMin}
        advisory={
          advisory === null
            ? null
            : t(
                'The city database is bloated: {size} for {rows} — it can be compacted (needs your «yes»).',
                {
                  size: formatBytes(Number(advisory.size_bytes)),
                  rows: storeRows(advisory.live_rows),
                },
              )
        }
      />

      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <CpuPanel
          live={latest}
          samples={shown}
          now={edge}
          windowMs={windowMs}
          sustained={sustained}
        />
        <MemoryPanel live={latest} samples={shown} now={edge} windowMs={windowMs} />
        <DiskPanel live={latest} samples={shown} now={edge} windowMs={windowMs} />
      </div>

      <WhoEatsMac live={latest} />

      <div className="space-y-6">
        <CityIssues
          slice={attention.city}
          unreadable={unreadable}
          readiness={attention.cityReadiness}
        />
        <CityFacts
          supervisor={supervisor.data ?? null}
          tools={tools.data ?? null}
          rigStores={rigStores.data ?? null}
          status={statusBody}
          trend={trend.data ?? null}
        />
      </div>
    </section>
  );
}

const TONE_LABEL: Readonly<Record<HostTone, string>> = {
  ok: 'Calm',
  warn: 'Attention',
  critical: 'Alarm',
};

const TONE_DOT: Readonly<Record<HostTone, string>> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  critical: 'bg-accent',
};

const TONE_TEXT: Readonly<Record<HostTone, string>> = {
  ok: 'text-ok',
  warn: 'text-warn',
  critical: 'text-accent',
};

function Verdict({
  live,
  sustained,
  error,
  windowMin,
  onWindow,
  advisory,
}: {
  live: LiveHealth | null;
  /** Busy % averaged over the last 30 s (lib/hostHeadline sustainedBusy). */
  sustained: number | null;
  error: string | null;
  windowMin: WindowMinutes;
  onWindow: (m: WindowMinutes) => void;
  advisory: string | null;
}) {
  const headline = live === null ? null : buildHeadline(live, sustained);
  const tone = headline?.tone ?? 'ok';
  return (
    <header data-host-tone={headline === null ? undefined : tone} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <p className="text-label font-semibold text-fg-muted">{t('Health')}</p>
          {headline !== null && (
            <span
              className={`inline-flex items-center gap-1.5 text-label font-semibold ${TONE_TEXT[tone]}`}
            >
              <span
                aria-hidden="true"
                className={`relative inline-flex h-2 w-2 rounded-full ${TONE_DOT[tone]}`}
              >
                <span
                  className={`absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:hidden ${TONE_DOT[tone]}`}
                />
              </span>
              {t(TONE_LABEL[tone])}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden text-label text-fg-faint sm:inline">
            {t('Live, every {s} s', { s: LIVE_POLL_MS / 1000 })}
          </span>
          <div
            role="group"
            aria-label={t('Chart window')}
            className="inline-flex rounded-md border border-rule bg-surface-raised p-0.5"
          >
            {WINDOWS.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={windowMin === m}
                onClick={() => onWindow(m)}
                className={`rounded px-2.5 py-1 text-label font-medium tabular-nums transition-colors ${
                  windowMin === m ? 'bg-surface-tint text-fg' : 'text-fg-muted hover:text-fg'
                }`}
              >
                {t('{n} min', { n: m })}
              </button>
            ))}
          </div>
        </div>
      </div>
      <h1 className="max-w-[44ch] text-[1.625rem] font-semibold leading-[1.2] tracking-tight text-fg [text-wrap:balance] md:text-[2.125rem] xl:text-[2.5rem]">
        {headline === null
          ? error === null
            ? t('Reading the Mac…')
            : t('The live reading failed: {error}', { error })
          : headline.sentence}
      </h1>
      {advisory !== null && (
        <p className="flex max-w-prose items-start gap-2.5 text-body text-fg">
          <span
            aria-hidden="true"
            className="mt-[0.45rem] inline-block h-2 w-2 shrink-0 rounded-full bg-warn"
          />
          <span>{advisory}</span>
        </p>
      )}
    </header>
  );
}

function Panel({
  title,
  value,
  tone,
  detail,
  children,
  className = '',
}: {
  className?: string;
  title: string;
  value: ReactNode;
  tone: HostTone | null;
  detail: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      data-host-tone={tone ?? undefined}
      className={`min-w-0 rounded-lg border border-rule bg-surface-raised px-5 pb-4 pt-4 ${className}`}
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-label font-semibold text-fg-muted">{title}</h2>
          <p className="mt-1 text-[1.75rem] font-semibold leading-8 tracking-tight text-fg">
            {value}
          </p>
        </div>
        {tone !== null && tone !== 'ok' && (
          <span
            className={`mt-0.5 inline-flex items-center gap-1.5 text-label font-semibold ${TONE_TEXT[tone]}`}
          >
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${TONE_DOT[tone]}`} />
            {t(TONE_LABEL[tone])}
          </span>
        )}
      </div>
      <div className="mb-3 min-h-[2.5rem] text-label text-fg-muted">{detail}</div>
      {children}
    </section>
  );
}

interface PanelProps {
  live: LiveHealth | null;
  samples: LiveSample[];
  now: number;
  windowMs: number;
}

const pct = (v: number) => formatPct(Math.round(v));

function points(samples: LiveSample[], pick: (s: LiveSample) => number | null) {
  return samples.map((s) => ({ at: s.at, v: pick(s) }));
}

// Coordinator 16.11: the CPU figure and axis never pass 100 %. The figure is
// busy % across all cores; the run queue is a plain line under it.
function CpuPanel({
  live,
  samples,
  now,
  windowMs,
  sustained,
}: PanelProps & { sustained: number | null }) {
  const busy = live === null ? null : busyPctOf(live);
  const queue = live === null ? null : cpuQueueLine(live);
  const series: ChartSeries[] = [
    {
      id: 'busy',
      label: t('busy'),
      color: 'var(--viz-1)',
      kind: 'area',
      points: points(samples, (s) => s.busyPct),
    },
  ];
  return (
    <Panel
      title={t('CPU')}
      value={busy === null ? '—' : pct(busy)}
      tone={live === null ? null : cpuToneOf(live, sustained)}
      detail={
        live === null ? null : (
          <>
            <p>{t('busy right now, share of all {n} cores', { n: live.cpu.cores })}</p>
            {queue !== null && <p>{queue}</p>}
          </>
        )
      }
    >
      <LiveChart
        label={t('CPU')}
        series={series}
        now={now}
        windowMs={windowMs}
        formatValue={pct}
        yMin={100}
        yCap={100}
      />
    </Panel>
  );
}

const PRESSURE_LABEL: Readonly<Record<string, string>> = {
  normal: 'memory pressure: normal',
  warn: 'memory pressure: elevated',
  critical: 'memory pressure: critical',
  unknown: 'memory pressure: not reported',
};

function MemoryPanel({ live, samples, now, windowMs }: PanelProps) {
  const mem = live?.memory.status === 'available' ? live.memory.value : null;
  const series: ChartSeries[] = [
    {
      id: 'used',
      label: t('used'),
      color: 'var(--viz-1)',
      kind: 'area',
      points: points(samples, (s) =>
        s.memUsedBytes === null || s.memTotalBytes === null || s.memTotalBytes <= 0
          ? null
          : (100 * s.memUsedBytes) / s.memTotalBytes,
      ),
    },
  ];
  return (
    <Panel
      title={t('Memory')}
      value={
        mem === null
          ? '—'
          : t('{used} of {total}', {
              used: formatBytes(mem.used_bytes),
              total: formatBytes(mem.total_bytes),
            })
      }
      tone={mem === null ? null : memoryTone(mem)}
      detail={
        mem === null ? null : (
          <>
            <p>{t(PRESSURE_LABEL[mem.pressure] ?? 'memory pressure: not reported')}</p>
            {mem.swap_total_bytes > 0 && (
              <p>{t('swap in use: {swap}', { swap: formatBytes(mem.swap_used_bytes) })}</p>
            )}
          </>
        )
      }
    >
      <LiveChart
        label={t('Memory')}
        series={series}
        now={now}
        windowMs={windowMs}
        formatValue={pct}
      />
    </Panel>
  );
}

function DiskPanel({ live, samples, now, windowMs }: PanelProps) {
  const disk = live?.disk.status === 'available' ? live.disk.value : null;
  const usedPct =
    disk === null ? null : (100 * (disk.total_bytes - disk.free_bytes)) / disk.total_bytes;
  const warnLine =
    disk === null
      ? undefined
      : {
          value: (100 * (disk.total_bytes - HOST_THRESHOLDS.diskWarnFreeBytes)) / disk.total_bytes,
          label: t('{free} left', { free: formatBytes(HOST_THRESHOLDS.diskWarnFreeBytes) }),
        };
  const series: ChartSeries[] = [
    {
      id: 'used',
      label: t('used'),
      color: 'var(--viz-1)',
      kind: 'area',
      points: points(samples, (s) =>
        s.diskFreeBytes === null || s.diskTotalBytes === null || s.diskTotalBytes <= 0
          ? null
          : (100 * (s.diskTotalBytes - s.diskFreeBytes)) / s.diskTotalBytes,
      ),
    },
  ];
  return (
    <Panel
      className="md:col-span-2 xl:col-span-1"
      title={t('Disk')}
      value={disk === null ? '—' : t('{free} free', { free: formatBytes(disk.free_bytes) })}
      tone={disk === null ? null : diskTone(disk)}
      detail={
        disk === null || usedPct === null ? null : (
          <p>
            {t('{pct} of {total} used', {
              pct: pct(usedPct),
              total: formatBytes(disk.total_bytes),
            })}
          </p>
        )
      }
    >
      <LiveChart
        label={t('Disk')}
        series={series}
        now={now}
        windowMs={windowMs}
        formatValue={pct}
        {...(warnLine !== undefined && warnLine.value > 0 ? { threshold: warnLine } : {})}
      />
    </Panel>
  );
}

type StatusState =
  | { status: 'available'; data: StatusBody }
  | { status: 'unavailable'; error: string };

async function fetchSupervisor(): Promise<SupervisorState> {
  const cityName = getActiveCity();
  if (cityName === null) throw new Error('Health page loaded before an active city was resolved');
  try {
    return {
      status: 'available',
      data: await supervisorApiForRequestBudget(HEALTH_SUPERVISOR_REQUEST_TIMEOUT_MS).cityHealth(
        cityName,
      ),
    };
  } catch {
    return { status: 'unavailable', error: 'supervisor health unavailable' };
  }
}

async function fetchStatus(): Promise<StatusState> {
  try {
    const report: SupervisorStatusReport = await api.supervisorStatus();
    if (report.status !== null) return { status: 'available', data: report.status };
    return { status: 'unavailable', error: report.available ? 'no status' : report.reason };
  } catch {
    return { status: 'unavailable', error: 'supervisor status unavailable' };
  }
}

async function fetchTools(): Promise<LocalToolVersions | null> {
  try {
    return await api.localToolVersions();
  } catch {
    return null;
  }
}

async function fetchTrend(): Promise<DoltNomsTrend> {
  try {
    return await api.doltTrend();
  } catch {
    return { available: false, reason: 'sample_failed', samples: [] };
  }
}

async function fetchRigStores(): Promise<RigStoreHealthReport> {
  try {
    return await api.rigStoreHealth();
  } catch {
    return { available: false, reason: 'fetch_failed', rigs: [] };
  }
}
