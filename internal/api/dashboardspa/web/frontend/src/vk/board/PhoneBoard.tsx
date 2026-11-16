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
      className={cn(
        // Phone-Board.dc.html: gap 6, padding 8 16, a rule under the row.
        '-mx-4 flex gap-1.5 overflow-x-auto border-b border-vk-border px-4 py-2 font-vk-sans',
        className,
      )}
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
              'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[3px] border px-3 text-[15px] focus-mark',
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
      {/* Phone-Board: the rows run edge to edge, one rule under each (the card's own). */}
      <div className="-mx-4 flex min-w-0 flex-col">
        {cards.length === 0 ? (
          <p className="border-b border-vk-border px-4 py-2.5 text-sm text-vk-text-low">{t('Nothing here')}</p>
        ) : (
          cards.map((card) => (
            <KanbanCard
              key={card.key}
              card={card}
              nowMs={nowMs}
              selected={card.key === selectedId}
              onSelect={onSelect}
              sessions={sessions}
              beadById={beadById}
              waitersOf={model.waitersOf}
              variant="list"
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
