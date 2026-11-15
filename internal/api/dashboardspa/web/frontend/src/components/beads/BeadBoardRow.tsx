import { useEffect, useRef } from 'react';
import type { BeadNode } from '../../lib/beadGraph';
import type { BadgeSeverity } from '../../attention/compose';
import { attentionListItemProps } from '../../attention/routeHighlight';

// One bead on the board: a two-line title, then the bead id as a copyable id
// tag with its priority and a compact `needs N · blocks M` annotation. No
// per-row status colour and no side stripe. Selection is a blue tint and an
// inset hairline (you pressed it), plus `aria-pressed`. Clicking a row opens
// the bead detail pop-out (gascity-dashboard-14s1), where the full navigable
// dependency tree has room to read.

interface BeadBoardRowProps {
  node: BeadNode;
  selected: boolean;
  attentionSeverity?: BadgeSeverity | null;
  /**
   * Compact liveness note for in-progress rows (gp-6xd): the waiting/stalled
   * reason, or `assignee · active Nm ago`. Rendered on its own label line so
   * the operator reads who holds the bead and whether they are alive without
   * opening the modal.
   */
  note?: string | null;
  onSelect: (beadId: string) => void;
}

// The note inherits the row's attention tone: red for attention (stalled),
// amber for watch (waiting), quiet otherwise (a healthy assignee · activity
// line).
function noteTone(severity: BadgeSeverity | null): string {
  if (severity === 'attention') return 'text-accent';
  if (severity === 'watch') return 'text-warn';
  return 'text-fg-faint';
}

export function BeadBoardRow({
  node,
  selected,
  attentionSeverity = null,
  note = null,
  onSelect,
}: BeadBoardRowProps) {
  const { bead, deps, blocks, hasUnresolvedDeps } = node;
  const rowRef = useRef<HTMLLIElement | null>(null);
  const depCount = deps.length;
  const blockCount = blocks.length;
  const hasNeighbourhood = depCount > 0 || blockCount > 0;

  const { className: attentionClassName = '', ...attentionProps } =
    attentionListItemProps(attentionSeverity);

  useEffect(() => {
    if (!selected) return;
    rowRef.current?.scrollIntoView?.({
      block: 'center',
      inline: 'nearest',
    });
  }, [selected]);

  return (
    <li
      ref={rowRef}
      {...attentionProps}
      className={`rounded-md transition-colors duration-150 ease-out-quart ${
        selected ? 'bg-primary/[0.08] ring-1 ring-inset ring-primary/40' : 'hover:bg-surface-tint'
      } ${attentionClassName}`}
    >
      <button
        type="button"
        onClick={() => onSelect(bead.id)}
        className="block w-full rounded-md px-2.5 py-2 text-left focus-mark"
        aria-pressed={selected}
        title={`Select ${bead.id}`}
      >
        <span
          className={`line-clamp-2 min-w-0 text-body text-fg [overflow-wrap:anywhere] ${
            selected ? 'font-semibold' : 'font-medium'
          }`}
        >
          {bead.title}
        </span>
        <span className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-label text-fg-muted">
          <span className="min-w-0 font-mono text-[0.8125rem] text-fg-muted [overflow-wrap:anywhere]">
            {bead.id}
          </span>
          {bead.priority != null && <span className="tnum">P{bead.priority}</span>}
          {hasNeighbourhood && (
            <span className="tnum">
              {depCount > 0 && `needs ${depCount}`}
              {depCount > 0 && blockCount > 0 && ' · '}
              {blockCount > 0 && `blocks ${blockCount}`}
            </span>
          )}
          {hasUnresolvedDeps && <span className="text-warn">unresolved</span>}
        </span>
        {note !== null && note.length > 0 && (
          <span className={`mt-0.5 block text-label ${noteTone(attentionSeverity)}`}>{note}</span>
        )}
      </button>
    </li>
  );
}
