import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { BadgeSeverity } from '../../attention/compose';
import { attentionHighlightClass, attentionListItemProps } from '../../attention/routeHighlight';
import { t, tn } from '../../i18n';
import type { BoardCard } from '../../lib/boardModel';
import { routeRunHref, type StageMark, type TaskStage } from '../../lib/stageBoard';
import { formatWhen } from '../../lib/whenText';
import { ExternalLink } from '../../vk/ExternalLink';
import { StatusShape } from '../icons';

// One card on the board (OWNER-HOME-PLAN B6, RB6): the title first, then one
// card line in plain words — what the task waits for, what it holds, the city
// tag, P0/P1 — and the copyable id last and faint. Busy stages add the step
// line (the city's own step label) and the PR link; Merged says when and why.
// Selection is a tint and an inset hairline, plus `aria-pressed`. A click
// opens the bead dialog, where the full dependency tree has room to read.

interface BeadBoardRowProps {
  card: BoardCard;
  selected: boolean;
  attentionSeverity?: BadgeSeverity | null;
  /**
   * Liveness note for in-progress rows (gp-6xd). Shown only for a card no
   * live route holds (RB15): the route carries the session, not the task.
   */
  note?: string | null;
  nowMs: number;
  onSelect: (beadId: string) => void;
}

// A route attention mark is the stop shape plus a word, in ink: the card's
// tint carries the colour, so the board keeps the One Mark Rule.
function StageMarkView({ mark }: { mark: StageMark }) {
  if (mark.tone === 'attention') {
    return (
      <span title={mark.title} className="inline-flex items-center gap-1 font-semibold text-fg">
        <StatusShape tone="stuck" />
        {t(mark.label)}
      </span>
    );
  }
  if (mark.tone === 'warn') {
    return (
      <span title={mark.title} className="inline-flex items-center gap-1 font-medium text-warn">
        <StatusShape tone="warn" />
        {t(mark.label)}
      </span>
    );
  }
  return (
    <span title={mark.title} className="text-fg-muted">
      {t(mark.label)}
    </span>
  );
}

const STEP_LINK =
  'min-w-0 rounded-sm text-primary underline-offset-2 hover:underline focus-mark [overflow-wrap:anywhere]';

function StepLine({ stage }: { stage: TaskStage }) {
  const { root, step, stepLabel, pr } = stage;
  const hasStep = stepLabel !== null && stepLabel.length > 0;
  if (!hasStep && pr === null) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 px-2 pb-1 text-label">
      {hasStep &&
        (root !== null ? (
          <Link
            to={routeRunHref(root, step)}
            title={
              step !== null
                ? t('Open step {id} in its run', { id: step.id })
                : t('Open run {id}', { id: root.id })
            }
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
          <ExternalLink href={pr.url} className={`tnum ${STEP_LINK}`}>
            {pr.number !== null ? `PR #${pr.number}` : 'PR'}
          </ExternalLink>
        ) : (
          <span className="tnum text-fg-muted">{`PR #${pr.number}`}</span>
        ))}
    </div>
  );
}

function waitWord(card: BoardCard): ReactNode {
  const { wait, stage } = card;
  if (wait === null) return null;
  switch (wait.kind) {
    case 'ready':
      return t('ready to take');
    case 'queued':
      return stage.root !== null ? (
        <Link
          to={routeRunHref(stage.root, null)}
          title={t('Open run {id}', { id: stage.root.id })}
          className={STEP_LINK}
        >
          {t('Queued')}
        </Link>
      ) : (
        t('Queued')
      );
    case 'tasks':
      return tn(wait.count, { one: 'waits for {n} task', other: 'waits for {n} tasks' });
    case 'decision':
      return t('waits for a decision: «{title}»', { title: wait.gate.title });
    case 'held':
      return t('waits for another task');
    case 'paused':
      return t('⏸ Paused');
  }
}

function CardLine({ card, nowMs }: { card: BoardCard; nowMs: number }) {
  const bead = card.node.bead;
  const merged = card.stage.stage === 'merged';
  const parts: ReactNode[] = [];
  if (merged) {
    const when = bead.updated_at ?? bead.created_at;
    parts.push(t('merged {when}', { when: formatWhen(when, nowMs) }));
  } else {
    const word = waitWord(card);
    if (word !== null) parts.push(word);
    if (card.holds > 0) {
      parts.push(tn(card.holds, { one: 'holds {n} task', other: 'holds {n} tasks' }));
    }
  }
  if (card.tag !== null) parts.push(card.tag);
  if (bead.priority != null && bead.priority <= 1) parts.push(`P${bead.priority}`);
  return (
    <div
      data-card-line=""
      className="mt-0.5 px-2 pb-1 text-label text-fg-muted [overflow-wrap:anywhere]"
    >
      {parts.map((part, index) => (
        <Fragment key={index}>
          <span>{part}</span>
          {', '}
        </Fragment>
      ))}
      <span className="font-mono text-[0.75rem] text-fg-faint">{bead.id}</span>
    </div>
  );
}

export function BeadBoardRow({
  card,
  selected,
  attentionSeverity = null,
  note = null,
  nowMs,
  onSelect,
}: BeadBoardRowProps) {
  const { stage } = card;
  const bead = card.node.bead;
  const merged = stage.stage === 'merged';
  const busy = stage.stage === 'working' || stage.stage === 'review' || stage.stage === 'pr';
  const routeAttention = stage.marks.find((mark) => mark.tone === 'attention') ?? null;
  const rowRef = useRef<HTMLLIElement | null>(null);
  // RB15: a live route holds the task; its liveness note would mislead.
  const showNote =
    note !== null && note.length > 0 && (stage.root === null || stage.root.status === 'closed');

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
      className={`rounded border-b border-rule py-1 last:border-b-0 ${
        selected ? 'bg-surface-tint ring-1 ring-inset ring-primary/40' : ''
      } ${attentionClassName} ${routeTint}`}
    >
      <button
        type="button"
        onClick={() => onSelect(bead.id)}
        className="block w-full rounded px-2 py-1.5 text-left focus-mark hover:bg-surface-tint"
        aria-pressed={selected}
        title={t('Select {id}', { id: bead.id })}
      >
        <span
          className={`line-clamp-3 min-w-0 text-body font-medium [overflow-wrap:anywhere] ${
            merged ? 'text-fg-muted' : 'text-fg'
          } ${selected ? 'font-semibold' : ''}`}
        >
          {bead.title}
        </span>
      </button>
      <CardLine card={card} nowMs={nowMs} />
      {(busy || (merged && !bead.close_reason)) && <StepLine stage={stage} />}
      {merged && bead.close_reason && (
        <p className="line-clamp-2 px-2 pb-1 text-label text-fg-faint [overflow-wrap:anywhere]">
          {bead.close_reason}
        </p>
      )}
      {stage.marks.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 px-2 pb-1 text-label">
          {stage.marks.map((mark) => (
            <StageMarkView key={mark.kind} mark={mark} />
          ))}
        </div>
      )}
      {showNote && <p className={`px-2 pb-1 text-label ${noteTone(attentionSeverity)}`}>{note}</p>}
    </li>
  );
}

// The note inherits the row's attention tone: red for attention (stalled),
// amber for watch (waiting), quiet otherwise.
function noteTone(severity: BadgeSeverity | null): string {
  if (severity === 'attention') return 'text-accent';
  if (severity === 'watch') return 'text-warn';
  return 'text-fg-faint';
}
