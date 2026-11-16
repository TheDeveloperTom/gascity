import { useId, useMemo } from 'react';
import { t, tn } from '../../i18n';
import { blockerIds, buildWaitersIndex } from '../../lib/waitReasons';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { milestoneOf } from '../../lib/waitReasons';
import { cardLabel } from '../board/cardLabel';
import { taskShortLabel } from './drawerFacts';

// Graph sprint 16.11 (Graph-Jump.dc.html, V5-Click.dc.html): on the graph the
// open card's drawer says «Почему стоит» (what it waits on) and «Её ждут»
// (what waits on it). Every row is a button: it moves the selection, and the
// page shows «← <previous>» to step back.

interface ChainRow {
  id: string;
  label: string;
  title: string;
  status: string | null;
}

function rowOf(id: string, byId: ReadonlyMap<string, SupervisorBead>): ChainRow {
  const bead = byId.get(id);
  if (bead === undefined) return { id, label: id, title: id, status: null };
  // The card's own label and title (cardLabel), as on the board and the graph.
  const card = cardLabel({ title: bead.title ?? id, milestone: milestoneOf(bead), id: bead.id });
  const label = card.label ?? taskShortLabel(bead);
  const title = card.title.length > 0 ? card.title : id;
  return { id, label, title, status: bead.status ?? null };
}

/** Rows for the drawer: direct blockers, direct waiters, and how many more wait further down. */
export function graphChainRows(
  bead: SupervisorBead,
  items: readonly SupervisorBead[],
): { why: ChainRow[]; waits: ChainRow[]; further: number } {
  const byId = new Map(items.map((b) => [b.id, b]));
  const waitersOf = buildWaitersIndex(items);
  const why = blockerIds(bead)
    .filter((id) => byId.get(id)?.status !== 'closed')
    .map((id) => rowOf(id, byId));
  const direct = waitersOf.get(bead.id) ?? [];
  const seen = new Set<string>([bead.id, ...direct]);
  const queue = [...direct];
  let further = 0;
  while (queue.length > 0) {
    const next = queue.shift() as string;
    for (const w of waitersOf.get(next) ?? []) {
      if (seen.has(w)) continue;
      seen.add(w);
      further += 1;
      queue.push(w);
    }
  }
  return { why, waits: direct.map((id) => rowOf(id, byId)), further };
}

function Row({ row, onOpen, cameFrom }: { row: ChainRow; onOpen: (id: string) => void; cameFrom: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(row.id)}
      className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-sm py-1 text-left hover:bg-vk-bg-secondary focus-mark md:min-h-8"
    >
      <span className="shrink-0 whitespace-nowrap font-vk-mono text-sm text-vk-text-normal">{row.label}</span>
      <span className="min-w-0 flex-1 truncate text-base text-vk-text-high">{row.title}</span>
      {cameFrom && <span className="shrink-0 text-sm text-vk-text-low">{t('you came from here')}</span>}
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 text-vk-text-low">
        <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function Section({
  title,
  summary,
  rows,
  onOpen,
  cameFrom,
}: {
  title: string;
  summary: string;
  rows: ChainRow[];
  onOpen: (id: string) => void;
  cameFrom: string | null;
}) {
  const id = useId();
  // Owner 16.11: an empty section is not drawn (a question card showed bare headings).
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-2 py-1">
        <h3 id={id} className="text-sm font-medium text-vk-text-high">
          {title}
        </h3>
        <span className="text-sm text-vk-text-low">{summary}</span>
      </div>
      {rows.map((row) => (
        <Row key={row.id} row={row} onOpen={onOpen} cameFrom={row.id === cameFrom} />
      ))}
    </section>
  );
}

export interface GraphChainProps {
  bead: SupervisorBead;
  items: readonly SupervisorBead[];
  onOpenBead: (id: string) => void;
  /** The card the owner jumped here from (marked «ты пришёл отсюда»). */
  cameFrom?: string | null;
}

export function GraphChain({ bead, items, onOpenBead, cameFrom = null }: GraphChainProps) {
  const { why, waits, further } = useMemo(() => graphChainRows(bead, items), [bead, items]);
  return (
    <div data-testid="graph-chain" className="flex flex-col gap-3">
      <Section
        title={t('Why it stands')}
        summary={why.length === 0 ? t('nothing, it can go') : tn(why.length, { one: '{n} task in the way', other: '{n} tasks in the way' })}
        rows={why}
        onOpen={onOpenBead}
        cameFrom={cameFrom}
      />
      <Section
        title={t('Waiting on it')}
        summary={
          waits.length === 0
            ? t('nobody waits')
            : further > 0
              ? t('{now} right away, {more} more further', { now: waits.length, more: further })
              : t('{now} right away', { now: waits.length })
        }
        rows={waits}
        onOpen={onOpenBead}
        cameFrom={cameFrom}
      />
    </div>
  );
}

/** «← M04 #3»: back to the card the owner came from. */
export function BackCrumb({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex min-h-11 items-center gap-1 self-start rounded-sm px-1 text-sm text-vk-text-low hover:text-vk-text-high focus-mark md:min-h-7"
    >
      {`← ${label}`}
    </button>
  );
}

/** «Показать на графе» (Graph-Jump.dc.html), next to «Обсудить с Мэром». */
export function ShowOnGraphButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-sm border border-vk-border bg-vk-bg-secondary px-2.5 text-[15px] text-vk-text-high hover:bg-vk-bg-panel focus-mark md:h-8"
    >
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
        <circle cx="3.5" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="12.5" cy="4" r="1.8" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="12.5" cy="12" r="1.8" stroke="currentColor" strokeWidth="1.3" />
        <path d="M5.2 7.3l5.6-2.6M5.2 8.7l5.6 2.6" stroke="currentColor" strokeWidth="1.3" />
      </svg>
      {t('Show on graph')}
    </button>
  );
}
