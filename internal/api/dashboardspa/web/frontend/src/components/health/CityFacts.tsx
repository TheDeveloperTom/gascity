import type { ReactNode } from 'react';
import type {
  DoltNomsTrend,
  LocalToolVersion,
  LocalToolVersions,
  RigStoreHealthReport,
  RigStoreRollup,
} from 'gas-city-dashboard-shared';
import type { HealthOutputBody, StatusBody } from 'gas-city-dashboard-shared/gc-supervisor';
import { t, tn } from '../../i18n';
import { formatBytes } from '../../lib/hostHeadline';

// The city's own facts, kept but quiet (owner 16.11): the supervisor, the
// installed tools, the bead stores and the city database. One compact row of
// definition blocks under the live charts.

export type SupervisorState =
  | { status: 'available'; data: HealthOutputBody }
  | { status: 'unavailable'; error: string };

export type StoreHealth = NonNullable<StatusBody['store_health']>;

/** A city database over its MB-per-row threshold: worth compacting. */
export function storeAdvisory(store: StoreHealth | undefined): StoreHealth | null {
  if (store === undefined || !store.rows_measured || store.live_rows <= 0) return null;
  return store.ratio_mb_per_row > store.threshold_mb_per_row ? store : null;
}

export function storeRows(n: number): string {
  return tn(n, { one: '{n} row', other: '{n} rows' });
}

export function formatUptime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  const days = Math.floor(sec / 86_400);
  const hours = Math.floor((sec % 86_400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  if (days > 0) return t('{d} d {h} h', { d: days, h: hours });
  if (hours > 0) return t('{h} h {m} min', { h: hours, m: minutes });
  if (minutes > 0) return t('{m} min', { m: minutes });
  return t('{s} s', { s: Math.floor(sec) });
}

const ROLLUP_LABEL: Readonly<Record<RigStoreRollup, string>> = {
  ok: 'fine',
  warn: 'warnings',
  down: 'not working',
};

export function CityFacts({
  supervisor,
  tools,
  rigStores,
  status,
  trend,
}: {
  supervisor: SupervisorState | null;
  tools: LocalToolVersions | null;
  rigStores: RigStoreHealthReport | null;
  status: StatusBody | null;
  trend: DoltNomsTrend | null;
}) {
  const store = status?.store_health;
  return (
    <section aria-labelledby="city-facts-heading" className="min-w-0">
      <h2 id="city-facts-heading" className="mb-3 text-title font-semibold text-fg">
        {t('City')}
      </h2>
      <dl className="grid min-w-0 gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-2 xl:grid-cols-4">
        <Fact term={t('Supervisor')}>
          {supervisor === null ? (
            <Muted>{t('Reading…')}</Muted>
          ) : supervisor.status === 'unavailable' ? (
            <span className="text-accent">{t('Supervisor unreachable')}</span>
          ) : (
            <>
              <Line>{t('running {d}', { d: formatUptime(supervisor.data.uptime_sec) })}</Line>
              <Muted>
                {t('version')} <Value>{supervisor.data.version ?? '—'}</Value>
              </Muted>
            </>
          )}
        </Fact>
        <Fact term={t('Tools')}>
          {tools === null ? (
            <Muted>{t('Reading…')}</Muted>
          ) : (
            <ul className="space-y-0.5">
              <ToolLine name="gc" tool={tools.gc} />
              <ToolLine name="bd" tool={tools.beads} />
              <ToolLine name="dolt" tool={tools.dolt} />
            </ul>
          )}
        </Fact>
        <Fact term={t('Task stores')}>
          {rigStores === null ? (
            <Muted>{t('Reading…')}</Muted>
          ) : rigStores.rigs.length === 0 ? (
            <Muted>{t('No store reading yet')}</Muted>
          ) : (
            <ul className="space-y-0.5">
              {rigStores.rigs.map((rig) => (
                <li key={rig.rig} className="flex items-baseline gap-2">
                  <span
                    aria-hidden="true"
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                      rig.rollup === 'ok'
                        ? 'bg-ok'
                        : rig.rollup === 'warn'
                          ? 'bg-warn'
                          : 'bg-accent'
                    }`}
                  />
                  <span className="text-fg">{rig.rig}</span>
                  <span className="text-fg-muted">{t(ROLLUP_LABEL[rig.rollup])}</span>
                </li>
              ))}
            </ul>
          )}
        </Fact>
        <Fact term={t('City database')}>
          {status === null ? (
            <Muted>{t('Reading…')}</Muted>
          ) : store === undefined ? (
            <Muted>{t('Not reported by the supervisor')}</Muted>
          ) : (
            <>
              <Line>
                {formatBytes(Number(store.size_bytes))}, {storeRows(store.live_rows)}
              </Line>
              <Muted>
                {t('open {open}, ready {ready}, in progress {inProgress}', {
                  open: status.work.open,
                  ready: status.work.ready,
                  inProgress: status.work.in_progress,
                })}
              </Muted>
            </>
          )}
          {trend !== null && !trend.available && trend.reason === 'store_health_absent' && (
            <Muted>
              {t('The size trend is not kept: bd owns these stores, so this is expected.')}
            </Muted>
          )}
        </Fact>
      </dl>
    </section>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1 bg-surface-raised px-4 py-3.5">
      <dt className="text-label font-semibold text-fg-muted">{term}</dt>
      <dd className="min-w-0 space-y-1 text-body [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function Line({ children }: { children: ReactNode }) {
  return <p className="text-fg">{children}</p>;
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-label text-fg-muted">{children}</p>;
}

function Value({ children }: { children: ReactNode }) {
  return <span className="font-medium text-fg tabular-nums">{children}</span>;
}

function ToolLine({ name, tool }: { name: string; tool: LocalToolVersion }) {
  return (
    <li className="flex items-baseline gap-2">
      <span className="w-10 shrink-0 font-mono text-[13px] text-fg-muted">{name}</span>
      {tool.status === 'available' ? (
        <span className="font-medium text-fg tabular-nums">{tool.version}</span>
      ) : (
        <span className="text-warn" title={tool.reason}>
          {tool.reason.includes('not found on PATH') ? t('not found') : t('did not answer')}
        </span>
      )}
    </li>
  );
}
