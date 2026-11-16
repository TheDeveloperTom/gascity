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
 * the title wraps (`[overflow-wrap:anywhere]`, two lines) instead of
 * truncating; badges add «нужен ты», «срочно», «стоит N ч» and the blocker
 * relations named by milestone tag + short title; a step panel shows what the
 * agent does now. Card shell (padding, border, -1px margins) from the
 * approved Cards/Main design frames.
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
import { blockerIds, milestoneOf, titleStartsWithTag } from '../../lib/waitReasons';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { cn } from '../cn';
import { ExternalLink } from '../ExternalLink';
import { KanbanBadge } from './KanbanBadge';
import { PeerKanbanCard, PROJECT_COLOR } from './PeerKanbanCard';
import { PriorityIcon, priorityLevelOf } from './PriorityIcon';
import { RelationshipBadge } from './RelationshipBadge';
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

function relationLabel(bead: SupervisorBead): string {
  const tag = milestoneOf(bead);
  const title = shortTitle(bead.title);
  return tag === null || titleStartsWithTag(title, tag) ? title : `${tag} ${title}`;
}

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
  const running = isRunning(card, sessions);
  const active = stage.stage === 'working' || stage.stage === 'review' || stage.stage === 'pr';
  const progress = active ? lastProgressMs(card, sessions) : null;
  const stalledFor = progress !== null && nowMs - progress > STUCK_AFTER_MS ? nowMs - progress : null;
  const needsYou = (bead.labels ?? []).includes(OWNER_QUESTION_LABEL);
  const urgent = bead.priority != null && bead.priority <= 1 && stage.stage !== 'merged';

  const blockedBy: { id: string; label: string; title: string }[] = [];
  if (card.wait?.kind === 'decision') {
    blockedBy.push({ id: card.wait.gate.id, label: `«${shortTitle(card.wait.gate.title)}»`, title: card.wait.gate.title });
  }
  if (stage.stage === 'waiting' && (card.wait?.kind === 'tasks' || card.wait?.kind === 'held')) {
    for (const id of blockerIds(bead)) {
      const blocker = beadById(id);
      if (blocker !== undefined && blocker.status === 'closed') continue;
      blockedBy.push({ id, label: blocker ? relationLabel(blocker) : id, title: blocker?.title ?? id });
    }
  }
  const blocks = (stage.stage === 'merged' ? [] : (waitersOf?.get(bead.id) ?? [])).map((id) => {
    const waiter = beadById(id);
    return { id, label: waiter ? relationLabel(waiter) : id, title: waiter?.title ?? id };
  });
  const relations = [
    ...blockedBy.map((r) => ({ ...r, type: 'blocked_by' as const })),
    ...blocks.map((r) => ({ ...r, type: 'blocks' as const })),
  ];
  const pr = stage.pr;
  const stepLabel =
    active && stage.stepLabel !== null && stage.stepLabel.length > 0 && stage.stepLabel !== 'Queued'
      ? stage.stepLabel
      : null;
  const priority = priorityLevelOf(bead.priority);
  const routeAttention = stage.marks.find((mark) => mark.tone === 'attention') ?? null;

  return (
    <article
      ref={ref}
      data-bead-id={bead.id}
      data-card-key={card.key}
      data-stage={stage.stage}
      {...(routeAttention === null ? {} : { 'data-route-attention': routeAttention.kind })}
      {...(attentionSeverity === null ? {} : { 'data-attention-severity': attentionSeverity })}
      onClick={() => onSelect(bead.id)}
      className={cn(
        'group flex min-w-0 cursor-pointer flex-col gap-1 border-vk-border bg-vk-bg-primary p-2 font-vk-sans',
        variant === 'column' ? '-mx-px -mt-px border' : 'border-b',
        selected && 'relative z-[1] ring-1 ring-inset ring-vk-brand',
        className,
      )}
    >
      {/* Row 1: stage tag (or id) + running dots */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-vk-mono text-sm text-vk-text-low" title={bead.id}>
            {milestone ?? bead.id}
          </span>
          {running && <RunningDots />}
        </div>
        <PriorityIcon priority={priority} />
      </div>

      {/* Row 2: title — the card's one button (keyboard + screen reader) */}
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
          className={cn(
            'line-clamp-2 min-w-0 text-base [overflow-wrap:anywhere]',
            stage.stage === 'merged' ? 'text-vk-text-low' : 'text-vk-text-normal',
          )}
        >
          {bead.title}
        </span>
      </button>

      {/* Row 5: tags, PR, relationships */}
      {(milestone !== null ||
        card.tag !== null ||
        needsYou ||
        urgent ||
        stalledFor !== null ||
        pr !== null ||
        relations.length > 0 ||
        stage.marks.length > 0) && (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {milestone !== null && <KanbanBadge name={milestone} color={tagColor(milestone)} />}
          {card.tag !== null && <KanbanBadge name={card.tag} color={PROJECT_COLOR} />}
          {needsYou && <KanbanBadge name={t('needs you')} color={NEEDS_YOU_COLOR} />}
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
            <KanbanBadge name={t('stalled {age}', { age: ageText(stalledFor) })} tone="error" />
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
            />
          ))}
          {relations.length > VISIBLE_RELATIONS && (
            <span className="text-sm text-vk-text-low">+{relations.length - VISIBLE_RELATIONS}</span>
          )}
        </div>
      )}

      {/* What the agent does now */}
      {stepLabel !== null && (
        <div className="mt-1 flex min-w-0 flex-col gap-1 rounded-sm bg-vk-bg-panel p-2">
          {stage.root !== null ? (
            <Link
              to={routeRunHref(stage.root, stage.step)}
              onClick={(e) => e.stopPropagation()}
              title={
                stage.step !== null
                  ? t('Open step {id} in its run', { id: stage.step.id })
                  : t('Open run {id}', { id: stage.root.id })
              }
              className="line-clamp-2 rounded-sm text-sm text-vk-text-normal [overflow-wrap:anywhere] focus-mark hover:underline"
            >
              {stepLabel}
            </Link>
          ) : (
            <span className="line-clamp-2 text-sm text-vk-text-normal [overflow-wrap:anywhere]">
              {stepLabel}
            </span>
          )}
        </div>
      )}
    </article>
  );
}
