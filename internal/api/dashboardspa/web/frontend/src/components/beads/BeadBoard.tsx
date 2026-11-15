import type { ReactNode } from 'react';
import type { BadgeSeverity } from '../../attention/compose';
import { t } from '../../i18n';
import {
  BUSY_VISIBLE,
  MERGED_VISIBLE,
  type BoardCard,
  type BoardModel,
} from '../../lib/boardModel';
import { STAGES, type StageColumn, type StageId } from '../../lib/stageBoard';
import { FoldList } from '../FoldList';
import { BeadBoardRow } from './BeadBoardRow';
import { IdleNotice } from './IdleNotice';
import { BOARD_GRID, RouteLine } from './RouteLine';
import { WaitingGroups } from './WaitingGroups';

// The Beads board as one route (OWNER-HOME-PLAN B5, design pass 1 «Маршрут»):
// a route line with five stops, and one track hanging under each stop. Tracks
// have no box: a card is a row with a hairline under it. Nothing scrolls
// inside a box (RB5): Waiting folds by stage, Merged shows five, the busy
// tracks fold after twelve. When the middle is empty the board says why.

interface BeadBoardProps {
  model: BoardModel;
  selectedId: string | null;
  attentionSeverity?: (beadId: string) => BadgeSeverity | null;
  /** Liveness note per bead for in-progress rows (gp-6xd); see BeadBoardRow. */
  noteOf?: (beadId: string) => string | null;
  nowMs: number;
  onSelect: (beadId: string) => void;
  openGroups: ReadonlySet<string>;
  onToggleGroup: (key: string) => void;
  showAllHistory: boolean;
  onToggleHistory: () => void;
}

const MIDDLE: ReadonlySet<StageId> = new Set(['working', 'review', 'pr']);
const CARD_LIST = 'divide-y divide-rule';

function Track({
  stage,
  count,
  children,
  footer = null,
  className = '',
}: {
  stage: StageColumn;
  count: number;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={t(stage.label)}
      id={`stage-${stage.id}`}
      data-stage={stage.id}
      className={`min-w-0 scroll-mt-4 ${className}`}
    >
      <header className="mb-2 flex items-baseline gap-2 lg:sr-only">
        <h3 className="font-display text-[1.25rem] font-bold leading-6 text-fg">
          {t(stage.label)}
        </h3>
        <span className="font-display text-[1.25rem] font-bold leading-6 tnum text-fg-muted">
          {count}
        </span>
      </header>
      {count === 0 ? <p className="sr-only">{t('None')}</p> : children}
      {footer}
    </section>
  );
}

export function BeadBoard({
  model,
  selectedId,
  attentionSeverity,
  noteOf,
  nowMs,
  onSelect,
  openGroups,
  onToggleGroup,
  showAllHistory,
  onToggleHistory,
}: BeadBoardProps) {
  const { columns } = model;
  const counts: Record<StageId, number> = {
    waiting: columns.waiting.length,
    working: columns.working.length,
    review: columns.review.length,
    pr: columns.pr.length,
    merged: columns.merged.length,
  };
  const middleEmpty = counts.working + counts.review + counts.pr === 0;
  const idle = model.idle.state !== 'busy' && middleEmpty ? model.idle : null;

  const renderCard = (card: BoardCard) => (
    <BeadBoardRow
      key={card.node.bead.id}
      card={card}
      nowMs={nowMs}
      selected={card.node.bead.id === selectedId}
      attentionSeverity={attentionSeverity?.(card.node.bead.id) ?? null}
      note={noteOf?.(card.node.bead.id) ?? null}
      onSelect={onSelect}
    />
  );

  const stageOf = (id: StageId) => STAGES.find((s) => s.id === id) as StageColumn;

  const busyTrack = (id: StageId) => (
    <Track
      key={id}
      stage={stageOf(id)}
      count={counts[id]}
      // On a phone an empty middle stage stays out of the way.
      className={counts[id] === 0 ? 'hidden lg:block' : ''}
    >
      <FoldList
        items={columns[id]}
        limit={BUSY_VISIBLE}
        itemKey={(card) => card.node.bead.id}
        renderItem={renderCard}
        className={CARD_LIST}
      />
    </Track>
  );

  return (
    <section aria-label={t('Board')} className="space-y-6">
      <RouteLine counts={counts} />
      <div className={`grid grid-cols-1 items-start gap-y-8 lg:gap-x-6 ${BOARD_GRID}`}>
        <Track stage={stageOf('waiting')} count={counts.waiting}>
          <WaitingGroups
            groups={model.waitingGroups}
            fold={model.foldWaiting}
            openGroups={openGroups}
            onToggleGroup={onToggleGroup}
            renderCard={renderCard}
          />
        </Track>
        {idle !== null ? (
          <div className="order-first space-y-0 lg:order-none lg:col-span-3">
            {STAGES.filter((s) => MIDDLE.has(s.id)).map((s) => (
              <Track key={s.id} stage={s} count={0} className="hidden lg:block">
                {null}
              </Track>
            ))}
            <IdleNotice idle={idle} />
          </div>
        ) : (
          STAGES.filter((s) => MIDDLE.has(s.id)).map((s) => busyTrack(s.id))
        )}
        <Track
          stage={stageOf('merged')}
          count={counts.merged}
          footer={
            <button
              type="button"
              aria-pressed={showAllHistory}
              onClick={onToggleHistory}
              className="mt-2 rounded px-1 py-1 text-label text-fg-muted underline underline-offset-2 focus-mark hover:text-fg"
            >
              {showAllHistory ? t('Recent merges only') : t('Show all history')}
            </button>
          }
        >
          <FoldList
            items={columns.merged}
            limit={MERGED_VISIBLE}
            itemKey={(card) => card.node.bead.id}
            renderItem={renderCard}
            className={CARD_LIST}
            showLabel={(total) => t('Show {n} more', { n: total - MERGED_VISIBLE })}
            hideLabel={t('Show fewer')}
          />
        </Track>
      </div>
    </section>
  );
}
