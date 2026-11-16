/*
 * Portions of this file are adapted from vibe-kanban
 * (https://github.com/BloopAI/vibe-kanban, upstream commit 3f095f0186f6).
 *
 * Copyright BloopAI (vibe-kanban authors)
 *
 * vibe-kanban's LICENSE leaves its copyright line as the Apache template
 * placeholder ("Copyright [yyyy] [name of copyright owner]"); the holder above
 * is taken from its npx-cli/package.json "author" ("bloop") and its GitHub
 * organisation (BloopAI).
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified for the Gas City dashboard: the card reads one BoardCard (our
 * board model) instead of VK's issue props; useTranslation → our `t`; the
 * description preview, tag editor, assignee avatar, more-actions menu and PR
 * status badge are dropped (owner cuts); the PR is a plain `#N` ExternalLink;
 * vk11 (16.11, canvas 1:1): the top line is a short mono label from the title
 * / milestone / epic (cardLabel), never the bead id; the title is one line
 * with an ellipsis; an assignee avatar sits at the right («А» ты, «И»
 * Исполнитель, «Р» Ричард); chips are the epic dot chip, «ждёт тебя», the PR
 * number, compact relation chips (icon + short label, two then «+N»),
 * «срочно» and «стоит N ч» with a clock; no project tag. A step panel shows
 * what the agent does now with «сейчас». Card shell (padding, border, -1px
 * margins, selected border) from the approved Cards/Main frames.
 */
// Source: vibe-kanban packages/ui/src/components/KanbanCardContent.tsx

import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import type { BadgeSeverity } from '../../attention/compose';
import type { BeadAttentionSession } from '../../attention/beadsNeedingAttention';
import { sessionForBead } from '../../attention/beadsNeedingAttention';
import { t } from '../../i18n';
import { ageText, lastProgressMs, STUCK_AFTER_MS } from '../../lib/boardFacts';
import type { BoardCard } from '../../lib/boardModel';
import { OWNER_QUESTION_LABEL } from '../../lib/ownerQuestions';
import { routeRunHref } from '../../lib/stageBoard';
import { blockerIds, milestoneOf } from '../../lib/waitReasons';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { cn } from '../cn';
import { ExternalLink } from '../ExternalLink';
import { KanbanBadge } from './KanbanBadge';
import { CardAvatar } from './CardAvatar';
import { cardLabel } from './cardLabel';
import { PeerKanbanCard } from './PeerKanbanCard';
import { RelationshipBadge, type RelationshipDisplayType } from './RelationshipBadge';
import { RunningDots } from './RunningDots';

/** Milestone tag colours: the design's dots, picked by a stable hash of the key. */
const TAG_COLORS = ['#0EA5E9', '#EC4899', '#22C55E', '#F59E0B', '#8B5CF6', '#14B8A6'] as const;
const NEEDS_YOU_COLOR = '#F59E0B';
const SHORT_TITLE = 28;
const VISIBLE_RELATIONS = 2;

export function tagColor(key: string): string {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_COLORS[hash % TAG_COLORS.length] ?? TAG_COLORS[0];
}

const LIVE_STATES: ReadonlySet<string> = new Set(['active', 'awake', 'creating', 'start-pending']);

function isRunning(card: BoardCard, sessions: readonly BeadAttentionSession[]): boolean {
  if (card.stage.stage !== 'working') return false;
  const live = (b: SupervisorBead | null) => {
    if (b === null) return false;
    const session = sessionForBead(b, sessions);
    return session !== null && LIVE_STATES.has(session.state.trim().toLowerCase());
  };
  return live(card.node.bead) || live(card.stage.step);
}

function shortTitle(title: string): string {
  const clean = title.trim();
  return clean.length > SHORT_TITLE ? `${clean.slice(0, SHORT_TITLE - 1)}…` : clean;
}

function epicTitleOf(bead: SupervisorBead, beadById: (id: string) => SupervisorBead | undefined): string | null {
  if (!bead.parent) return null;
  const parent = beadById(bead.parent);
  return parent !== undefined && parent.issue_type === 'epic' ? parent.title : null;
}

/** A card's derived label and title (canvas: «M04 #3» over the bare title). */
export function labelOf(
  bead: SupervisorBead,
  beadById: (id: string) => SupervisorBead | undefined,
): { label: string | null; title: string } {
  return cardLabel({
    title: bead.title,
    milestone: milestoneOf(bead),
    epicTitle: epicTitleOf(bead, beadById),
    id: bead.id,
  });
}

/** A related task's chip text: its short label, else its short title — never its id. */
function relationLabel(bead: SupervisorBead, beadById: (id: string) => SupervisorBead | undefined): string {
  const derived = labelOf(bead, beadById);
  return derived.label ?? shortTitle(derived.title);
}

const CLOCK = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
    <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.6" />
    <path d="M8 5v3.2l2 1.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export interface KanbanCardProps {
  card: BoardCard;
  nowMs: number;
  selected: boolean;
  onSelect: (beadId: string) => void;
  sessions?: readonly BeadAttentionSession[];
  /** Board bead by id: names a blocker or a waiter by its tag and title. */
  beadById?: (id: string) => SupervisorBead | undefined;
  /** Open tasks that wait on a bead (BoardModel.waitersOf). */
  waitersOf?: ReadonlyMap<string, readonly string[]>;
  /** The attention model's verdict for this bead (exposed as a data attribute). */
  attentionSeverity?: BadgeSeverity | null;
  /** column: VK board cell (-1px overlap); list: the phone's single list (hairline below). */
  variant?: 'column' | 'list';
  className?: string;
  /** Peer cards only: «💬 N» (vk-final part 4). */
  commentCount?: number;
}

/** One board card; `onSelect` gets `card.key` (the bead id on my cards). */
export function KanbanCard(props: KanbanCardProps) {
  if (props.card.peer !== null) {
    return (
      <PeerKanbanCard
        card={props.card}
        selected={props.selected}
        onSelect={props.onSelect}
        {...(props.commentCount === undefined ? {} : { commentCount: props.commentCount })}
        {...(props.variant === undefined ? {} : { variant: props.variant })}
        {...(props.className === undefined ? {} : { className: props.className })}
      />
    );
  }
  return <OwnKanbanCard {...props} />;
}

function OwnKanbanCard({
  card,
  nowMs,
  selected,
  onSelect,
  sessions = [],
  beadById = () => undefined,
  waitersOf,
  attentionSeverity = null,
  variant = 'column',
  className,
}: KanbanCardProps) {
  const bead = card.node.bead;
  const { stage } = card;
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  }, [selected]);

  const milestone = milestoneOf(bead);
  const epicTitle = epicTitleOf(bead, beadById);
  const { label, title } = labelOf(bead, beadById);
  const epicChip = milestone ?? epicTitle;
  const running = isRunning(card, sessions);
  const active = stage.stage === 'working' || stage.stage === 'review' || stage.stage === 'pr';
  const progress = active ? lastProgressMs(card, sessions) : null;
  const stalledFor = progress !== null && nowMs - progress > STUCK_AFTER_MS ? nowMs - progress : null;
  const needsYou = (bead.labels ?? []).includes(OWNER_QUESTION_LABEL);
  const urgent = bead.priority != null && bead.priority <= 1 && stage.stage !== 'merged';

  const relations: { id: string; label: string; title: string; type: RelationshipDisplayType }[] = [];
  if (card.wait?.kind === 'decision') {
    const gate = card.wait.gate;
    const known = beadById(gate.id);
    relations.push({
      id: gate.id,
      label: known !== undefined ? relationLabel(known, beadById) : shortTitle(gate.title),
      title: gate.title,
      type: 'blocked_by',
    });
  }
  if (stage.stage === 'waiting' && (card.wait?.kind === 'tasks' || card.wait?.kind === 'held')) {
    for (const id of blockerIds(bead)) {
      const blocker = beadById(id);
      if (blocker !== undefined && blocker.status === 'closed') continue;
      relations.push({
        id,
        label: blocker ? relationLabel(blocker, beadById) : id,
        title: blocker?.title ?? id,
        type: 'blocked_by',
      });
    }
  }
  for (const id of stage.stage === 'merged' ? [] : (waitersOf?.get(bead.id) ?? [])) {
    const waiter = beadById(id);
    relations.push({
      id,
      label: waiter ? relationLabel(waiter, beadById) : id,
      title: waiter?.title ?? id,
      type: 'blocks',
    });
  }
  for (const dep of bead.dependencies ?? []) {
    if (dep.type !== 'related' || dep.depends_on_id === bead.id) continue;
    const other = beadById(dep.depends_on_id);
    if (other === undefined) continue;
    relations.push({ id: other.id, label: relationLabel(other, beadById), title: other.title, type: 'related' });
  }

  const pr = stage.pr;
  const stepLabel =
    active && stage.stepLabel !== null && stage.stepLabel.length > 0 && stage.stepLabel !== 'Queued'
      ? stage.stepLabel
      : null;
  const stepAge =
    progress === null || nowMs - progress < 60_000 ? t('now') : ageText(nowMs - progress);
  const routeAttention = stage.marks.find((mark) => mark.tone === 'attention') ?? null;
  const executor = stage.stage === 'working';

  return (
    <article
      ref={ref}
      data-bead-id={bead.id}
      data-card-key={card.key}
      {...(selected ? { 'aria-current': 'true' as const } : {})}
      data-stage={stage.stage}
      {...(routeAttention === null ? {} : { 'data-route-attention': routeAttention.kind })}
      {...(attentionSeverity === null ? {} : { 'data-attention-severity': attentionSeverity })}
      onClick={() => onSelect(bead.id)}
      className={cn(
        'group flex min-w-0 cursor-pointer flex-col gap-1 bg-vk-bg-primary p-2 font-vk-sans hover:bg-vk-bg-secondary',
        variant === 'column' ? '-mx-px -mt-px border' : 'border-b',
        // canvas Main: the open task keeps its background and gets a --sel (brand) border
        selected ? 'relative z-[1] border-vk-brand' : 'border-vk-border',
        className,
      )}
    >
      {/* Row 1: short label + running dots */}
      {(label !== null || running) && (
        <div className="flex min-w-0 items-center gap-1.5">
          {label !== null && (
            <span data-card-label="" className="truncate font-vk-mono text-sm text-vk-text-low">
              {label}
            </span>
          )}
          {running && <RunningDots />}
        </div>
      )}

      {/* Row 2: title on one line — the card's one button (keyboard + screen reader) */}
      <button
        type="button"
        aria-pressed={selected}
        title={t('Select {id}', { id: bead.id })}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(bead.id);
        }}
        className="min-w-0 rounded-sm text-left focus-mark"
      >
        <span
          title={bead.title}
          className={cn(
            'block min-w-0 truncate text-base',
            stage.stage === 'merged' ? 'text-vk-text-low' : 'text-vk-text-normal',
          )}
        >
          {title}
        </span>
      </button>

      {/* Row 3: assignee avatar at the right */}
      <div className="flex items-center justify-end text-vk-text-low">
        {executor ? (
          <CardAvatar letter="И" label={t('Implementer')} tone="executor" />
        ) : (
          <CardAvatar letter="А" label={t('Assignee: you')} tone="owner" />
        )}
      </div>

      {/* Row 4: chips */}
      {(epicChip !== null ||
        needsYou ||
        urgent ||
        stalledFor !== null ||
        pr !== null ||
        relations.length > 0 ||
        stage.marks.length > 0) && (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {epicChip !== null && (
            <KanbanBadge
              name={<span className="max-w-[12rem] truncate">{epicChip}</span>}
              color={tagColor(epicChip)}
              {...(epicTitle !== null && milestone === null ? { title: epicTitle } : {})}
            />
          )}
          {needsYou && <KanbanBadge name={t('waits for you')} color={NEEDS_YOU_COLOR} />}
          {pr !== null &&
            (pr.url !== null ? (
              <ExternalLink
                href={pr.url}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center rounded-sm px-0.5 py-px font-vk-mono text-[13px] text-vk-text-low focus-mark hover:text-vk-text-high"
              >
                {pr.number !== null ? `#${pr.number}` : 'PR'}
              </ExternalLink>
            ) : (
              <span className="px-0.5 font-vk-mono text-[13px] text-vk-text-low">{`#${pr.number}`}</span>
            ))}
          {urgent && <KanbanBadge name={t('urgent')} tone="error" />}
          {stalledFor !== null && (
            <KanbanBadge name={t('stalled {age}', { age: ageText(stalledFor) })} tone="error" icon={CLOCK} />
          )}
          {stage.marks.map((mark) => (
            <KanbanBadge
              key={mark.kind}
              name={t(mark.label)}
              {...(mark.title === undefined ? {} : { title: mark.title })}
              tone={mark.tone === 'attention' ? 'error' : 'default'}
            />
          ))}
          {relations.slice(0, VISIBLE_RELATIONS).map((rel) => (
            <RelationshipBadge
              key={`${rel.type}:${rel.id}`}
              displayType={rel.type}
              relatedIssueDisplayId={rel.label}
              title={rel.title}
              compact
            />
          ))}
          {relations.length > VISIBLE_RELATIONS && (
            <span className="text-sm text-vk-text-low">+{relations.length - VISIBLE_RELATIONS}</span>
          )}
        </div>
      )}

      {/* What the agent does now (canvas: «Исполнитель пишет код» / dots · сейчас) */}
      {stepLabel !== null && (
        <div data-step-panel="" className="mt-1 flex min-w-0 flex-col gap-1 rounded-sm bg-vk-bg-panel p-2">
          {stage.root !== null ? (
            <Link
              to={routeRunHref(stage.root, stage.step)}
              onClick={(e) => e.stopPropagation()}
              title={
                stage.step !== null
                  ? t('Open step {id} in its run', { id: stage.step.id })
                  : t('Open run {id}', { id: stage.root.id })
              }
              className="block truncate rounded-sm text-sm text-vk-text-normal focus-mark hover:underline"
            >
              {stepLabel}
            </Link>
          ) : (
            <span className="block truncate text-sm text-vk-text-normal">{stepLabel}</span>
          )}
          <span className="flex items-center gap-1.5 text-xs text-vk-text-low">
            {running && <RunningDots />}
            {stepAge}
          </span>
        </div>
      )}
    </article>
  );
}
