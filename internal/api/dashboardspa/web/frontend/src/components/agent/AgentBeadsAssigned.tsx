import type { SupervisorBead } from '../../supervisor/beadReads';
import { FoldList } from '../FoldList';
import { StatusBadge, beadStatusTone } from '../StatusBadge';

// Beads assigned to this agent (AD-07). Open work is listed; closed work is
// history, folded behind `Show N closed` so a long-lived agent's page stays
// one screen (DESIGN-PLAN R8). The header count is every assigned bead.

export function AgentBeadsAssigned({
  beads,
  error,
  loading,
  onSelect,
}: {
  beads: ReadonlyArray<SupervisorBead>;
  error: string | null;
  loading: boolean;
  onSelect: (bead: SupervisorBead) => void;
}) {
  const open = beads.filter((b) => b.status !== 'closed');
  const closed = beads.filter((b) => b.status === 'closed');
  const renderBead = (b: SupervisorBead) => (
    <li key={b.id} className="py-2.5">
      <button
        type="button"
        onClick={() => onSelect(b)}
        className="line-clamp-2 min-w-0 text-left text-body font-medium text-fg hover:text-primary hover:underline focus-mark [overflow-wrap:anywhere]"
        title={`Open ${b.id}`}
      >
        {b.title}
      </button>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-[0.8125rem] text-fg-muted [overflow-wrap:anywhere]">
          {b.id}
        </span>
        <StatusBadge tone={beadStatusTone(b.status)} label={b.status.replace(/_/g, ' ')} />
      </div>
    </li>
  );

  return (
    <section className="rounded-lg border border-rule bg-surface-raised">
      <header className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
        <h2 className="text-title font-semibold text-fg">Beads assigned</h2>
        <span className="inline-flex min-w-[1.375rem] justify-center rounded-full bg-fg/[0.06] px-1.5 text-label font-semibold text-fg-muted tnum">
          {loading ? '·' : beads.length}
        </span>
      </header>
      <div className="px-4 py-2">
        {error !== null ? (
          <p className="py-2 text-body text-accent" role="alert">
            {error}
          </p>
        ) : loading ? (
          <p className="py-2 text-body text-fg-muted">Loading beads.</p>
        ) : beads.length === 0 ? (
          <p className="py-2 text-body text-fg-muted">No beads assigned to this agent.</p>
        ) : (
          <>
            {open.length > 0 ? (
              <ul className="divide-y divide-rule">{open.map(renderBead)}</ul>
            ) : (
              <p className="py-2 text-body text-fg-muted">No open beads.</p>
            )}
            <FoldList
              items={closed}
              limit={0}
              itemKey={(b) => b.id}
              renderItem={renderBead}
              showLabel={(n) => `Show ${n} closed`}
              hideLabel="Hide closed"
              className="divide-y divide-rule border-t border-rule"
            />
          </>
        )}
      </div>
    </section>
  );
}
