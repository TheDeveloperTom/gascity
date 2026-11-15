import { useMemo, useState } from 'react';
import type { BeadAttentionSession } from '../../attention/beadsNeedingAttention';
import { t } from '../../i18n';
import type { BoardModel } from '../../lib/boardModel';
import { cn } from '../cn';
import { KanbanCard } from './KanbanCard';
import { boardColumns, useBeadLookup, type VkColumn, type VkColumnId } from './KanbanColumn';

// The phone board (DESIGN Phone-Board, 390 px): a scrollable row of column
// chips (44 px tap targets) over one list — the chosen column's cards only.
// The page board (BeadBoard) reuses ColumnChips and hides the other columns
// with CSS, so each card is in the DOM once; PhoneBoard is the standalone
// phone list (one column rendered).

export interface ColumnChipsProps {
  columns: readonly VkColumn[];
  active: VkColumnId;
  onPick: (id: VkColumnId) => void;
  className?: string;
}

export function ColumnChips({ columns, active, onPick, className }: ColumnChipsProps) {
  return (
    <div
      role="group"
      aria-label={t('Board columns')}
      className={cn('-mx-4 flex gap-2 overflow-x-auto px-4 pb-3 font-vk-sans', className)}
    >
      {columns.map((c) => {
        const pressed = c.id === active;
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={pressed}
            onClick={() => onPick(c.id)}
            className={cn(
              'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-sm border px-3 text-[15px] focus-mark',
              pressed
                ? 'border-vk-brand bg-vk-bg-primary font-medium text-vk-text-high'
                : 'border-vk-border bg-vk-bg-secondary text-vk-text-normal',
            )}
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: c.color }}
            />
            {`${c.label} ${c.cards.length}`}
          </button>
        );
      })}
    </div>
  );
}

export interface PhoneBoardProps {
  model: BoardModel;
  nowMs: number;
  selectedId: string | null;
  onSelect: (beadId: string) => void;
  sessions?: readonly BeadAttentionSession[];
  className?: string;
}

export function PhoneBoard({
  model,
  nowMs,
  selectedId,
  onSelect,
  sessions = [],
  className,
}: PhoneBoardProps) {
  const [active, setActive] = useState<VkColumnId>('waiting');
  const [showOld, setShowOld] = useState(false);
  const columns = useMemo(() => boardColumns(model, nowMs), [model, nowMs]);
  const beadById = useBeadLookup(model);
  const column = columns.find((c) => c.id === active) ?? columns[0];
  const cards = column === undefined ? [] : [...column.cards, ...(showOld ? column.older : [])];

  return (
    <div className={cn('min-w-0 font-vk-sans', className)}>
      <ColumnChips columns={columns} active={active} onPick={setActive} />
      <div className="flex min-w-0 flex-col border-x border-vk-border">
        {cards.length === 0 ? (
          <p className="border-y border-vk-border p-3 text-sm text-vk-text-low">{t('Nothing here')}</p>
        ) : (
          cards.map((card) => (
            <KanbanCard
              key={card.node.bead.id}
              card={card}
              nowMs={nowMs}
              selected={card.node.bead.id === selectedId}
              onSelect={onSelect}
              sessions={sessions}
              beadById={beadById}
              waitersOf={model.waitersOf}
              variant="list"
              className="first:border-t"
            />
          ))
        )}
      </div>
      {column?.id === 'merged' && column.older.length > 0 && (
        <button
          type="button"
          aria-expanded={showOld}
          onClick={() => setShowOld((v) => !v)}
          className="mt-1 h-11 rounded-sm px-2 text-sm text-vk-text-low focus-mark"
        >
          {showOld ? t('Hide older') : t('Show older')}
        </button>
      )}
    </div>
  );
}
