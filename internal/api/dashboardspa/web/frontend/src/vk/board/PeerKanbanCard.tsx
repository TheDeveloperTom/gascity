import { useEffect, useRef } from 'react';
import { t } from '../../i18n';
import { asOfClock } from '../../lib/boardOwner';
import type { BoardCard } from '../../lib/boardModel';
import { milestoneOf } from '../../lib/waitReasons';
import { cn } from '../cn';
import { ExternalLink } from '../ExternalLink';
import { KanbanBadge } from './KanbanBadge';

// vk-final part 3: a card from a peer's board (design Main, «Изменение схемы
// users»). Read-only: rig on top, the title, then «● Ричарда», the project,
// «на HH:MM» and the «Р» avatar. No «нужен ты», no stall or relation badges:
// those are his city's facts, judged there (SYNC-PLAN review focus 2).

/** The peer city's side colour (`--vk-peer`, teal; mine is `--vk-mine`, the brand). */
export const PEER_COLOR = 'oklch(var(--vk-peer))';
/** The project tag's dot (design Main: the slate «crm-api» tag). */
export const PROJECT_COLOR = '#64748B';

export interface PeerKanbanCardProps {
  card: BoardCard;
  selected: boolean;
  onSelect: (key: string) => void;
  /** «💬 N» (vk-final part 4); hidden at 0. */
  commentCount?: number;
  variant?: 'column' | 'list';
  className?: string;
}

export function PeerAvatar({
  letter,
  label,
  size = 20,
}: {
  letter: string;
  label?: string;
  size?: 16 | 20;
}) {
  return (
    <span
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
      // design Peer-Card (redrawn 15.11): an initials avatar in a side-colour ring
      className={cn(
        'box-border inline-flex shrink-0 items-center justify-center rounded-full border-[1.5px] border-vk-peer bg-vk-bg-secondary font-semibold text-vk-text-high',
        size === 20 ? 'h-5 w-5 text-[11px]' : 'h-4 w-4 text-[10px]',
      )}
    >
      {letter}
    </span>
  );
}

export function PeerKanbanCard({
  card,
  selected,
  onSelect,
  commentCount = 0,
  variant = 'column',
  className,
}: PeerKanbanCardProps) {
  const bead = card.node.bead;
  const peer = card.peer;
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  }, [selected]);
  if (peer === null) return null;
  const milestone = milestoneOf(bead);
  const pr = card.stage.pr;
  const clock = asOfClock(peer.asOf);

  return (
    <article
      ref={ref}
      data-card-key={card.key}
      data-owner={card.owner}
      data-stage={card.stage.stage}
      onClick={() => onSelect(card.key)}
      className={cn(
        'group flex min-w-0 cursor-pointer flex-col gap-1 border-vk-border bg-vk-bg-primary p-2 font-vk-sans',
        variant === 'column' ? '-mx-px -mt-px border' : 'border-b',
        selected && 'relative z-[1] ring-1 ring-inset ring-vk-brand',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-vk-mono text-sm text-vk-text-low" title={bead.id}>
          {milestone ?? peer.rig}
        </span>
      </div>

      <button
        type="button"
        aria-pressed={selected}
        title={t('Select {id}', { id: bead.id })}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(card.key);
        }}
        className="min-w-0 rounded-sm text-left focus-mark"
      >
        <span
          className={cn(
            'line-clamp-2 min-w-0 text-base [overflow-wrap:anywhere]',
            card.stage.stage === 'merged' ? 'text-vk-text-low' : 'text-vk-text-normal',
          )}
        >
          {bead.title}
        </span>
      </button>

      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <KanbanBadge name={peer.label} color={PEER_COLOR} />
          <KanbanBadge name={peer.rig} color={PROJECT_COLOR} />
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
          {commentCount > 0 && (
            <span
              aria-label={t('{n} comments', { n: commentCount })}
              className="inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-[13px] text-vk-text-low"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M2.5 4h11v6.5H7.2L4 13v-2.5H2.5z"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
              {commentCount}
            </span>
          )}
          {clock.length > 0 && (
            <span
              title={t("Data from {owner} city as of this time", { owner: peer.label })}
              className={cn('px-0.5 text-[13px]', peer.stale ? 'text-warn' : 'text-vk-text-low')}
            >
              {t('as of {time}', { time: clock })}
            </span>
          )}
        </div>
        <PeerAvatar letter={peer.avatar} label={t('Card of {owner}', { owner: peer.label })} />
      </div>
    </article>
  );
}
