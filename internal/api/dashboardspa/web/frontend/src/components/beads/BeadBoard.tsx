import { BOARD_COLUMNS, type BeadNode, type BoardColumnId } from '../../lib/beadGraph';
import { BeadBoardRow } from './BeadBoardRow';
import type { BadgeSeverity } from '../../attention/compose';

// The Beads board: status columns (kanban) whose rows carry the dependency
// graph (gascity-dashboard-6frc). Each column is a panel with a header (name
// plus count) and a body that scrolls inside a fixed height, so a column of a
// thousand beads stays one screen tall instead of stretching the page. The
// only red mark on the board is the blocked count when it crosses zero (an
// anomaly count); status is otherwise carried by the column a bead sits in,
// not by a per-row badge, so the page reads in greyscale. An empty column
// collapses to its header strip at every width (screen readers hear "None").
//
// Takes already-grouped `columns` (rather than the whole graph) so the
// caller can render one board per rig from subsets of a single shared
// graph, keeping cross-rig dependency edges resolved.

interface BeadBoardProps {
  columns: Record<BoardColumnId, BeadNode[]>;
  selectedId: string | null;
  attentionSeverity?: (beadId: string) => BadgeSeverity | null;
  /** Liveness note per bead for in-progress rows (gp-6xd); see BeadBoardRow. */
  noteOf?: (beadId: string) => string | null;
  onSelect: (beadId: string) => void;
}

const NEUTRAL_COUNT =
  'inline-flex min-w-[1.375rem] justify-center rounded-full bg-fg/[0.06] px-1.5 text-label font-semibold text-fg-muted tnum';
const ALARM_COUNT =
  'inline-flex min-w-[1.375rem] justify-center rounded-full bg-accent/10 px-1.5 text-label font-semibold text-accent tnum';

export function BeadBoard({
  columns,
  selectedId,
  attentionSeverity,
  noteOf,
  onSelect,
}: BeadBoardProps) {
  return (
    <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {BOARD_COLUMNS.map((col) => {
        const nodes = columns[col.id];
        const isBlocked = col.id === 'blocked';
        const countClass = isBlocked && nodes.length > 0 ? ALARM_COUNT : NEUTRAL_COUNT;
        return (
          <section
            key={col.id}
            aria-label={col.label}
            className="flex min-w-0 flex-col rounded-lg border border-rule bg-surface-raised"
          >
            <header
              className={`flex items-center justify-between gap-3 px-3 py-2.5 ${
                nodes.length === 0 ? '' : 'border-b border-rule'
              }`}
            >
              {/* Sentence case in the text itself (R5: no case transforms);
                  the region name stays the lowercase `aria-label`. */}
              <h3 className="text-label font-semibold text-fg">
                {`${col.label.charAt(0).toUpperCase()}${col.label.slice(1)}`}
              </h3>
              <span className={countClass}>{nodes.length}</span>
            </header>
            {nodes.length === 0 ? (
              <p className="sr-only">None</p>
            ) : (
              <ul className="max-h-[28rem] space-y-0.5 overflow-y-auto overscroll-contain p-1.5">
                {nodes.map((node) => (
                  <BeadBoardRow
                    key={node.bead.id}
                    node={node}
                    selected={node.bead.id === selectedId}
                    attentionSeverity={attentionSeverity?.(node.bead.id) ?? null}
                    note={noteOf?.(node.bead.id) ?? null}
                    onSelect={onSelect}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
