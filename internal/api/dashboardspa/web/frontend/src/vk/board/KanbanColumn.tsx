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
  /** Merged only: cards closed before the 7-day window (behind «Показать старые»). */
  older: readonly BoardCard[];
}

/** Ждёт / В работе / Ревью (review + pr) / «Влито · за 7 дней». */
export function boardColumns(model: BoardModel, nowMs: number): VkColumn[] {
  const recent = mergedWithin(model, nowMs);
  const recentKeys = new Set(recent.map((card) => card.key));
  const older = model.columns.merged.filter((card) => !recentKeys.has(card.key));
  return [
    { id: 'waiting', label: t('Waiting'), color: '#3B82F6', cards: model.columns.waiting, older: [] },
    { id: 'working', label: t('Working'), color: '#F59E0B', cards: model.columns.working, older: [] },
    {
      id: 'review',
      label: t('Review'),
      color: '#8B5CF6',
      cards: [...model.columns.review, ...model.columns.pr],
      older: [],
    },
    { id: 'merged', label: t('Merged · last 7 days'), color: '#22C55E', cards: recent, older },
  ];
}

export const KanbanProvider = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div
    className={cn(
      // vk-final: the four columns share the full width (no 1600 px cap).
      'flex min-w-0 flex-col md:grid md:min-h-full md:w-full md:min-w-[800px] md:grid-cols-4 md:items-stretch md:divide-x md:divide-vk-border md:border-x md:border-vk-border',
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
}: {
  name: string;
  color: string;
  count: number;
  className?: string;
}) => (
  <div
    className={cn(
      'sticky top-0 z-20 flex shrink-0 items-center gap-2 border-y border-vk-border bg-vk-bg-secondary p-2',
      className,
    )}
  >
    <span className="flex flex-1 items-center gap-2">
      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <h3 className="m-0 text-sm font-normal text-vk-text-normal">{name}</h3>
      <span className="text-sm text-vk-text-low tnum">{count}</span>
    </span>
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
}

export function KanbanColumn({ column, children, footer = null, phoneActive = true }: KanbanColumnProps) {
  return (
    <section
      aria-label={column.label}
      data-column={column.id}
      className={cn(
        'min-w-0 flex-col border-x border-vk-border font-vk-sans md:border-x-0',
        phoneActive ? 'flex' : 'hidden md:flex',
      )}
    >
      <KanbanHeader
        name={column.label}
        color={column.color}
        count={column.cards.length}
        className="hidden md:flex"
      />
      <KanbanCards>{children}</KanbanCards>
      {footer}
    </section>
  );
}
