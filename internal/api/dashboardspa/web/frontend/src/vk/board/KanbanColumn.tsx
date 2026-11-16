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
 * Modified for the Gas City dashboard: KanbanProvider / KanbanHeader /
 * KanbanCards without drag and drop (no @hello-pangea/dnd) and without the
 * add-task button and tooltip; colours as plain CSS colours; useTranslation →
 * our `t`. `boardColumns` maps our five stages onto the four VK columns.
 */
// Source: vibe-kanban packages/ui/src/components/KanbanBoard.tsx

import { useMemo, type ReactNode } from 'react';
import { t } from '../../i18n';
import { mergedWithin } from '../../lib/boardFacts';
import type { BoardCard, BoardModel } from '../../lib/boardModel';
import { STAGES } from '../../lib/stageBoard';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { cn } from '../cn';

/** Every card bead of the model by id (blocker / waiter names on a card). */
export function useBeadLookup(model: BoardModel): (id: string) => SupervisorBead | undefined {
  return useMemo(() => {
    const byId = new Map<string, SupervisorBead>();
    for (const stage of STAGES) {
      // My cards only: a peer card's id may name a different bead of mine.
      for (const card of model.columns[stage.id]) {
        if (card.peer === null) byId.set(card.node.bead.id, card.node.bead);
      }
    }
    return (id: string) => byId.get(id);
  }, [model]);
}

export type VkColumnId = 'waiting' | 'working' | 'review' | 'merged';

export interface VkColumn {
  id: VkColumnId;
  label: string;
  color: string;
  cards: readonly BoardCard[];
  /** Merged only: the rest, behind «Показать старые» (newer first). */
  older: readonly BoardCard[];
  /** The header count: every card of the column (merged: the 7-day window). */
  count: number;
}

/** Main.dc.html: «Влито · за 7 дней» shows the newest three merges. */
export const MERGED_SHOWN = 3;

/** Ждёт / В работе / Ревью (review + pr) / «Влито · за 7 дней». */
export function boardColumns(model: BoardModel, nowMs: number): VkColumn[] {
  const recent = mergedWithin(model, nowMs);
  const recentKeys = new Set(recent.map((card) => card.key));
  const beforeWindow = model.columns.merged.filter((card) => !recentKeys.has(card.key));
  const review = [...model.columns.review, ...model.columns.pr];
  return [
    {
      id: 'waiting',
      label: t('Waiting'),
      color: '#3B82F6',
      cards: model.columns.waiting,
      older: [],
      count: model.columns.waiting.length,
    },
    {
      id: 'working',
      label: t('Working'),
      color: '#F59E0B',
      cards: model.columns.working,
      older: [],
      count: model.columns.working.length,
    },
    { id: 'review', label: t('Review'), color: '#8B5CF6', cards: review, older: [], count: review.length },
    {
      id: 'merged',
      label: t('Merged · last 7 days'),
      color: '#22C55E',
      cards: recent.slice(0, MERGED_SHOWN),
      older: [...recent.slice(MERGED_SHOWN), ...beforeWindow],
      count: recent.length,
    },
  ];
}

export const KanbanProvider = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div
    className={cn(
      // VK 1:1 (Main.dc.html): an inline grid of columns 200–400 px wide,
      // hairlines between them and at both ends, no boxes.
      'flex min-w-0 flex-col md:inline-grid md:min-h-full md:grid-flow-col md:auto-cols-[minmax(200px,400px)] md:items-stretch md:divide-x md:divide-vk-border md:border-x md:border-vk-border',
      className,
    )}
  >
    {children}
  </div>
);

export const KanbanHeader = ({
  name,
  color,
  count,
  className,
  onAdd,
}: {
  name: string;
  color: string;
  count: number;
  className?: string;
  /** The «+» button (Main.dc.html); absent = the button shows but does nothing. */
  onAdd?: () => void;
}) => (
  <div
    className={cn(
      'sticky top-0 z-20 flex shrink-0 items-center justify-between gap-2 border-y border-vk-border bg-vk-bg-secondary p-2',
      className,
    )}
  >
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <h3 className="m-0 text-sm font-normal text-vk-text-high">{name}</h3>
      <span className="text-sm text-vk-text-low tnum">{count}</span>
    </span>
    <button
      type="button"
      aria-label={t('Add to «{column}»', { column: name })}
      onClick={onAdd}
      className="flex h-5 w-5 items-center justify-center p-0 text-vk-text-low focus-mark hover:text-vk-text-high"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </button>
  </div>
);

export const KanbanCards = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('flex flex-1 flex-col', className)}>{children}</div>
);

export interface KanbanColumnProps {
  column: VkColumn;
  children: ReactNode;
  footer?: ReactNode;
  /** Phone: only the chosen column shows (CSS only); desktop shows all four. */
  phoneActive?: boolean;
  /** The header «+» (new task for this column). */
  onAdd?: () => void;
}

export function KanbanColumn({
  column,
  children,
  footer = null,
  phoneActive = true,
  onAdd,
}: KanbanColumnProps) {
  return (
    <section
      aria-label={column.label}
      data-column={column.id}
      className={cn(
        'min-w-0 flex-col border-x border-vk-border font-vk-sans md:min-h-[720px] md:border-x-0',
        phoneActive ? 'flex' : 'hidden md:flex',
      )}
    >
      <KanbanHeader
        name={column.label}
        color={column.color}
        count={column.count}
        className="hidden md:flex"
        {...(onAdd === undefined ? {} : { onAdd })}
      />
      <KanbanCards>{children}</KanbanCards>
      {footer}
    </section>
  );
}
