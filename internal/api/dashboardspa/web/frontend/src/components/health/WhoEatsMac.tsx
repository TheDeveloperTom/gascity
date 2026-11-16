import type { LiveHealth, ProcessUsage } from 'gas-city-dashboard-shared';
import { t, tn } from '../../i18n';
import { formatBytes, formatPct } from '../../lib/hostHeadline';
import { groupProcesses, type ProcessGroup, type ProcessGroupId } from '../../lib/processGroups';

// «Кто ест Мак» (owner 16.11): the process list grouped the way the owner
// thinks of the machine: agent sessions, the bead stores, the city's own
// supervisor, builds, browsers, the rest. Two columns, CPU and memory, the
// groups in a fixed order so the rows hold still between polls; under each,
// the heaviest names right now. Names only: the endpoint never sends args.

const GROUP_LABEL: Readonly<Record<ProcessGroupId, string>> = {
  agents: 'Agents',
  stores: 'Stores (dolt, bd)',
  supervisor: 'Supervisor and tmux',
  builds: 'Builds and tools',
  browsers: 'Browsers',
  other: 'Everything else',
};

type Measure = 'cpu' | 'memory';

const TOP_NAMES = 6;

export function WhoEatsMac({ live }: { live: LiveHealth | null }) {
  const processes = live?.processes ?? null;
  const cores = live?.cpu.cores ?? 1;
  return (
    <section
      aria-labelledby="who-eats-heading"
      className="min-w-0 rounded-lg border border-rule bg-surface-raised"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule px-5 py-4">
        <h2 id="who-eats-heading" className="text-title font-semibold text-fg">
          {t('Who eats the Mac')}
        </h2>
        {processes?.status === 'available' && (
          <span className="text-label text-fg-muted tabular-nums">
            {tn(processes.total, { one: '{n} process', other: '{n} processes' })}
          </span>
        )}
      </div>
      {processes === null ? (
        <p className="px-5 py-5 text-body text-fg-muted">{t('Reading…')}</p>
      ) : processes.status === 'unavailable' ? (
        <p className="px-5 py-5 text-body text-fg-muted">
          {processes.reason === 'not_loopback'
            ? t('The process list is visible only on the Mac itself (127.0.0.1).')
            : t('The process list could not be read just now.')}
        </p>
      ) : (
        <div className="grid min-w-0 lg:grid-cols-2 lg:divide-x lg:divide-rule">
          {(['cpu', 'memory'] as const).map((measure) => (
            <MeasureColumn
              key={measure}
              measure={measure}
              groups={groupProcesses(processes.items, processes.rest, cores)}
              items={processes.items}
              cores={cores}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MeasureColumn({
  measure,
  groups,
  items,
  cores,
}: {
  measure: Measure;
  groups: ProcessGroup[];
  items: readonly ProcessUsage[];
  cores: number;
}) {
  const valueOf = (g: ProcessGroup) => (measure === 'cpu' ? g.cpuPctOfMac : g.rssBytes);
  const format = (v: number) => (measure === 'cpu' ? formatPct(v, v < 10 ? 1 : 0) : formatBytes(v));
  const largest = Math.max(...groups.map(valueOf), measure === 'cpu' ? 1 : 1);
  const top = [...items]
    .sort((a, b) => (measure === 'cpu' ? b.cpu_pct - a.cpu_pct : b.rss_bytes - a.rss_bytes))
    .slice(0, TOP_NAMES)
    .filter((p) => (measure === 'cpu' ? p.cpu_pct > 0 : p.rss_bytes > 0));
  const heading = measure === 'cpu' ? t('By CPU') : t('By memory');
  return (
    <div className="min-w-0 border-t border-rule px-5 py-5 first:border-t-0 lg:border-t-0">
      <h3 className="mb-3 text-label font-semibold text-fg-muted">{heading}</h3>
      <ul className="space-y-2.5" aria-label={heading}>
        {groups.map((g) => {
          const v = valueOf(g);
          const share = largest > 0 ? v / largest : 0;
          const names = g.names
            .filter((n) => (measure === 'cpu' ? n.cpu_pct > 0 : n.rss_bytes > 0))
            .slice(0, 3);
          return (
            <li
              key={g.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_5.5rem]"
            >
              <div className="min-w-0 sm:col-start-1 sm:row-start-1">
                <p className="truncate text-body text-fg">{t(GROUP_LABEL[g.id])}</p>
                <p className="truncate text-[12px] leading-4 text-fg-faint">
                  {names.length > 0
                    ? names.map((n) => (n.count > 1 ? `${n.name} ×${n.count}` : n.name)).join(', ')
                    : '—'}
                </p>
              </div>
              <span className="text-right text-body font-medium text-fg tabular-nums sm:col-start-3 sm:row-start-1">
                {format(v)}
              </span>
              <div
                className="col-span-2 h-2 min-w-0 rounded-full bg-surface-tint sm:col-span-1 sm:col-start-2 sm:row-start-1"
                aria-hidden="true"
              >
                <div
                  className="h-2 rounded-full transition-[width] duration-500 ease-out-quart motion-reduce:transition-none"
                  style={{
                    width: `${Math.max(v > 0 ? 2 : 0, share * 100)}%`,
                    background: 'var(--viz-1)',
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {top.length > 0 && (
        <div className="mt-5 border-t border-rule pt-4">
          <h4 className="mb-2 text-label font-semibold text-fg-muted">{t('Heaviest right now')}</h4>
          <ol className="space-y-1">
            {top.map((p) => (
              <li key={p.name} className="flex items-baseline gap-2 text-body">
                <span className="min-w-0 truncate font-mono text-[13px] text-fg">{p.name}</span>
                {p.count > 1 && (
                  <span className="shrink-0 text-label text-fg-faint tabular-nums">×{p.count}</span>
                )}
                <span
                  aria-hidden="true"
                  className="mx-1 min-w-[1rem] flex-1 self-center border-b border-dotted border-rule"
                />
                <span className="w-[5.5rem] shrink-0 text-right text-fg-muted tabular-nums">
                  {measure === 'cpu'
                    ? formatPct(p.cpu_pct / (cores > 0 ? cores : 1), 1)
                    : formatBytes(p.rss_bytes)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
