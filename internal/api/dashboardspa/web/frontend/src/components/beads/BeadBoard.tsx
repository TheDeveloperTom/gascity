import { STAGES, type StageCard, type StageId } from '../../lib/stageBoard';
import { BeadBoardRow } from './BeadBoardRow';
import type { BadgeSeverity } from '../../attention/compose';

// The Beads board: one column per stage of our route (owner ruling
// 2026-11-15), Waiting → Working → Review → PR → Merged. A card is a task; the
// route's step beads fold into it and appear as its step line, never as cards
// of their own. Each column is a panel with a header (name plus count) and a
// body that scrolls inside a fixed height. Counts stay neutral: the board paints
// no red text, so attention lives on the card (tint plus a named stop shape).
// An empty column collapses to its header strip (screen readers hear "None").
//
// Takes already-derived `columns` so the caller can render one board per rig
// from a single shared graph and route index.

interface BeadBoardProps {
  columns: Record<StageId, StageCard[]>;
  selectedId: string | null;
  attentionSeverity?: (beadId: string) => BadgeSeverity | null;
  /** Liveness note per bead for in-progress rows (gp-6xd); see BeadBoardRow. */
  noteOf?: (beadId: string) => string | null;
  onSelect: (beadId: string) => void;
}

const NEUTRAL_COUNT =
  'inline-flex min-w-[1.375rem] justify-center rounded-full bg-fg/[0.06] px-1.5 text-label font-semibold text-fg-muted tnum';

export function BeadBoard({
  columns,
  selectedId,
  attentionSeverity,
  noteOf,
  onSelect,
}: BeadBoardProps) {
  return (
    <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {STAGES.map((col) => {
        const cards = columns[col.id];
        return (
          <section
            key={col.id}
            aria-label={col.label}
            data-stage={col.id}
            className="flex min-w-0 flex-col rounded-lg border border-rule bg-surface-raised"
          >
            <header
              className={`flex items-center justify-between gap-3 px-3 py-2.5 ${
                cards.length === 0 ? '' : 'border-b border-rule'
              }`}
            >
              <h3 className="text-label font-semibold text-fg">{col.label}</h3>
              <span className={NEUTRAL_COUNT}>{cards.length}</span>
            </header>
            {cards.length === 0 ? (
              <p className="sr-only">None</p>
            ) : (
              <ul className="max-h-[28rem] space-y-0.5 overflow-y-auto overscroll-contain p-1.5">
                {cards.map(({ node, stage }) => (
                  <BeadBoardRow
                    key={node.bead.id}
                    node={node}
                    stage={stage}
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
