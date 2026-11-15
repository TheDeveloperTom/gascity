import { useMemo } from 'react';
import type { BeadGraph, BeadNode } from '../../lib/beadGraph';
import { buildStageColumns, type RouteIndex } from '../../lib/stageBoard';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { BeadBoard } from './BeadBoard';
import type { BadgeSeverity } from '../../attention/compose';

// One rig's slice of the board (gascity-dashboard-6frc). The board groups
// by rig so a city with hundreds of beads stays parseable — each rig gets a
// title with a neutral count pill and its own stage columns, derived from the
// single shared graph and route index (so cross-rig dependency edges and
// route links still resolve).

interface BeadBoardSectionProps {
  /** Rig display name. */
  label: string;
  /** Bead count in this rig (matched set). */
  count: number;
  /** The full task graph; this section renders only its `ids`. */
  graph: BeadGraph;
  ids: ReadonlySet<string>;
  /** Route roots and steps of the whole fetch, folded into their tasks. */
  routeIndex: RouteIndex;
  /** Open stop cards keyed by the task they stop. */
  stopCards: ReadonlyMap<string, SupervisorBead>;
  selectedId: string | null;
  attentionSeverity?: (beadId: string) => BadgeSeverity | null;
  /** Liveness note per bead for in-progress rows (gp-6xd); see BeadBoardRow. */
  noteOf?: (beadId: string) => string | null;
  onSelect: (beadId: string) => void;
}

export function BeadBoardSection({
  label,
  count,
  graph,
  ids,
  routeIndex,
  stopCards,
  selectedId,
  attentionSeverity,
  noteOf,
  onSelect,
}: BeadBoardSectionProps) {
  const columns = useMemo(() => {
    const nodes: BeadNode[] = [];
    for (const id of ids) {
      const node = graph.nodes.get(id);
      if (node) nodes.push(node);
    }
    return buildStageColumns(nodes, routeIndex, stopCards);
  }, [graph, ids, routeIndex, stopCards]);
  return (
    <section aria-label={label}>
      <header className="mb-3 flex items-center gap-2">
        <h2 className="min-w-0 truncate text-title font-semibold text-fg">{label}</h2>
        <span className="inline-flex min-w-[1.375rem] justify-center rounded-full bg-fg/[0.06] px-1.5 text-label font-semibold text-fg-muted tnum">
          {count}
        </span>
      </header>
      <BeadBoard
        columns={columns}
        selectedId={selectedId}
        {...(attentionSeverity === undefined ? {} : { attentionSeverity })}
        {...(noteOf === undefined ? {} : { noteOf })}
        onSelect={onSelect}
      />
    </section>
  );
}
