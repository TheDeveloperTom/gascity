import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import type { BeadNode } from '../../lib/beadGraph';
import { routeRunHref, type StageMark, type TaskStage } from '../../lib/stageBoard';
import type { BadgeSeverity } from '../../attention/compose';
import { attentionHighlightClass, attentionListItemProps } from '../../attention/routeHighlight';
import { StatusShape } from '../icons';

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
  /**
   * The task's place on the route (stage board): the current step line with a
   * link into the run, the PR link, and its marks. Absent for a plain row.
   */
  stage?: TaskStage | null;
  onSelect: (beadId: string) => void;
}

// A route attention mark (stopped, failed route, TDD refused) is the stop
// shape plus a word, in ink: the card's tint carries the colour, so the board
// keeps the One Mark Rule (no `.text-accent` per card) and passes greyscale.
function StageMarkView({ mark }: { mark: StageMark }) {
  if (mark.tone === 'attention') {
    return (
      <span title={mark.title} className="inline-flex items-center gap-1 font-semibold text-fg">
        <StatusShape tone="stuck" />
        {mark.label}
      </span>
    );
  }
  if (mark.tone === 'warn') {
    return (
      <span title={mark.title} className="inline-flex items-center gap-1 font-medium text-warn">
        <StatusShape tone="warn" />
        {mark.label}
      </span>
    );
  }
  return (
    <span title={mark.title} className="text-fg-muted">
      {mark.label}
    </span>
  );
}

const STEP_LINK =
  'min-w-0 rounded-sm text-primary underline-offset-2 hover:underline focus-mark [overflow-wrap:anywhere]';

function StageLine({ stage }: { stage: TaskStage }) {
  const { root, step, stepLabel, pr, marks } = stage;
  const hasStep = stepLabel !== null && stepLabel.length > 0;
  if (!hasStep && pr === null && marks.length === 0) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 px-2.5 pb-2 text-label">
      {marks.map((mark) => (
        <StageMarkView key={mark.kind} mark={mark} />
      ))}
      {hasStep &&
        (root !== null ? (
          <Link
            to={routeRunHref(root, step)}
            title={step !== null ? `Open step ${step.id} in its run` : `Open run ${root.id}`}
            className={`line-clamp-2 ${STEP_LINK}`}
          >
            {stepLabel}
          </Link>
        ) : (
          <span
            title={stepLabel}
            className="line-clamp-2 min-w-0 text-fg-muted [overflow-wrap:anywhere]"
          >
            {stepLabel}
          </span>
        ))}
      {pr !== null &&
        (pr.url !== null ? (
          <a href={pr.url} target="_blank" rel="noreferrer" className={`tnum ${STEP_LINK}`}>
            {pr.number !== null ? `PR #${pr.number}` : 'PR'}
          </a>
        ) : (
          <span className="tnum text-fg-muted">{`PR #${pr.number}`}</span>
        ))}
    </div>
  );
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
  stage = null,
  onSelect,
}: BeadBoardRowProps) {
  const routeAttention = stage?.marks.find((mark) => mark.tone === 'attention') ?? null;
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

  // The attention model's tint wins; a route attention mark tints the card the
  // same way when the model has nothing to say about this bead.
  const routeTint =
    routeAttention !== null && attentionSeverity === null && !selected
      ? attentionHighlightClass('attention')
      : '';

  return (
    <li
      ref={rowRef}
      {...attentionProps}
      {...(routeAttention === null ? {} : { 'data-route-attention': routeAttention.kind })}
      className={`rounded-md transition-colors duration-150 ease-out-quart ${
        selected ? 'bg-primary/[0.08] ring-1 ring-inset ring-primary/40' : 'hover:bg-surface-tint'
      } ${attentionClassName} ${routeTint}`}
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
      {stage !== null && <StageLine stage={stage} />}
    </li>
  );
}
