import type { ReactNode } from 'react';
import type { DashboardSession } from 'gas-city-dashboard-shared';
import { effectiveContextPct } from 'gas-city-dashboard-shared';
import { formatRelative } from '../../hooks/time';

export function AgentMetadata({ session, now }: { session: DashboardSession; now: number }) {
  const pct = effectiveContextPct(session);
  const items: ReadonlyArray<{ label: string; value: ReactNode }> = [
    { label: 'Rig', value: session.rig ?? '·' },
    { label: 'Pool', value: session.pool ?? '·' },
    { label: 'Provider', value: session.provider ?? '·' },
    { label: 'Model', value: session.model ?? '·' },
    {
      label: 'Context',
      value:
        typeof pct === 'number' ? (
          <span
            className={`tnum ${pct >= 95 ? 'text-accent' : pct >= 80 ? 'text-warn' : 'text-fg'}`}
          >
            {pct}%
          </span>
        ) : (
          '·'
        ),
    },
    { label: 'Attached', value: session.attached ? 'yes' : 'no' },
    {
      label: 'Created',
      value: <span className="tnum">{formatRelative(session.created_at, now)}</span>,
    },
    {
      label: 'Last active',
      value: <span className="tnum">{formatRelative(session.last_active, now)}</span>,
    },
  ];

  return (
    <section
      aria-labelledby="agent-facts-title"
      className="rounded-lg border border-rule bg-surface-raised"
    >
      <header className="border-b border-rule px-4 py-3">
        <h2 id="agent-facts-title" className="text-title font-semibold text-fg">
          Facts
        </h2>
      </header>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-4 py-4">
        {items.map((it) => (
          <div key={it.label} className="min-w-0">
            <dt className="text-label font-medium text-fg-muted">{it.label}</dt>
            <dd className="text-body text-fg [overflow-wrap:anywhere]">{it.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
