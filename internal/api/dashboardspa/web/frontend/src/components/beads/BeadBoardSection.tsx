import type { BeadGraph } from '../../lib/beadGraph';
import { selectColumns } from '../../lib/beadGraph';
import { BeadBoard } from './BeadBoard';
import type { BadgeSeverity } from '../../attention/compose';

// One rig's slice of the board (gascity-dashboard-6frc). The board groups
// by rig so a city with hundreds of beads stays parseable — each rig gets a
// title with a neutral count pill and its own status columns, projected from
// the single shared graph (so cross-rig dependency edges still resolve).

interface BeadBoardSectionProps {
  /** Rig display name. */
  label: string;
  /** Bead count in this rig (matched set). */
  count: number;
  /** The full graph; this section renders only its `ids`. */
  graph: BeadGraph;
  ids: ReadonlySet<string>;
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
  selectedId,
  attentionSeverity,
  noteOf,
  onSelect,
}: BeadBoardSectionProps) {
  const columns = selectColumns(graph, ids);
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
