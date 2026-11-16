import { useMemo, useState } from 'react';
import type { BadgeSeverity } from '../../attention/compose';
import type { BeadAttentionSession } from '../../attention/beadsNeedingAttention';
import { t } from '../../i18n';
import type { BoardCard, BoardModel } from '../../lib/boardModel';
import { cn } from '../../vk/cn';
import { KanbanCard } from '../../vk/board/KanbanCard';
import {
  boardColumns,
  KanbanColumn,
  KanbanProvider,
  useBeadLookup,
  type VkColumnId,
} from '../../vk/board/KanbanColumn';
import { ColumnChips } from '../../vk/board/PhoneBoard';

// The «Доска» board as vibe-kanban columns (vk lane 1; DESIGN Main, Board-M04,
// Cards, Phone-Board): Ждёт / В работе / Ревью (review + pr) / «Влито · за 7
// дней», with «Показать старые» folding the older merges. One DOM for both
// widths: at md+ the four columns sit side by side; below md the column chips
// (`md:hidden`) pick the one column that shows — CSS only, no viewport hook,
// so every card is rendered once.

export interface BeadBoardProps {
  model: BoardModel;
  selectedId: string | null;
  nowMs: number;
  onSelect: (beadId: string) => void;
  sessions?: readonly BeadAttentionSession[];
  showAllHistory: boolean;
  onToggleHistory: () => void;
  className?: string;
  /** The attention model per bead: a data attribute on the card (no tint). */
  attentionSeverity?: (beadId: string) => BadgeSeverity | null;
  /** Kept for callers of the route board; the VK card shows no liveness note. */
  noteOf?: (beadId: string) => string | null;
  /** Peer cards' «💬 N» (vk-final part 4). */
  commentCountOf?: (card: BoardCard) => number;
  /** A column header's «+» (Main.dc.html): start a new task. */
  onAddTask?: () => void;
}

export function BeadBoard({
  model,
  selectedId,
  nowMs,
  onSelect,
  sessions = [],
  showAllHistory,
  onToggleHistory,
  className,
  attentionSeverity,
  commentCountOf,
  onAddTask,
}: BeadBoardProps) {
  const [showOld, setShowOld] = useState(showAllHistory);
  const [phoneColumn, setPhoneColumn] = useState<VkColumnId>('waiting');
  const columns = useMemo(() => boardColumns(model, nowMs), [model, nowMs]);
  const beadById = useBeadLookup(model);

  const renderCard = (card: BoardCard) => (
    <KanbanCard
      key={card.key}
      card={card}
      nowMs={nowMs}
      selected={card.key === selectedId}
      onSelect={onSelect}
      sessions={sessions}
      beadById={beadById}
      waitersOf={model.waitersOf}
      attentionSeverity={card.peer === null ? (attentionSeverity?.(card.node.bead.id) ?? null) : null}
      {...(commentCountOf === undefined ? {} : { commentCount: commentCountOf(card) })}
    />
  );

  const toggleOld = () => {
    const next = !showOld;
    setShowOld(next);
    // The open board holds only recent merges; older ones need the wide read.
    if (next !== showAllHistory) onToggleHistory();
  };

  return (
    <div className={cn('min-w-0', className)}>
      <ColumnChips
        columns={columns}
        active={phoneColumn}
        onPick={setPhoneColumn}
        className="md:hidden"
      />
      {/* Main.dc.html: the columns scroll sideways inside the page. */}
      <div className="min-w-0 md:overflow-x-auto md:pb-4">
        <KanbanProvider>
          {columns.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              phoneActive={column.id === phoneColumn}
              {...(onAddTask === undefined ? {} : { onAdd: onAddTask })}
              footer={
                column.id === 'merged' ? (
                  <button
                    type="button"
                    aria-expanded={showOld}
                    onClick={toggleOld}
                    className="m-1 h-11 self-start rounded-sm px-2 font-vk-sans text-sm text-vk-text-low focus-mark hover:text-vk-text-high md:h-8"
                  >
                    {showOld ? t('Hide older') : t('Show older')}
                  </button>
                ) : null
              }
            >
              {column.cards.map(renderCard)}
              {column.id === 'merged' && showOld && column.older.map(renderCard)}
            </KanbanColumn>
          ))}
        </KanbanProvider>
      </div>
    </div>
  );
}
