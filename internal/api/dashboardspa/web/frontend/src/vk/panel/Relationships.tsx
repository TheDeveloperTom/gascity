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
 * Modified for the Gas City dashboard: relationships are derived from bead
 * blockers (blockerIds / buildWaitersIndex) instead of issue relationships;
 * no remove action; two rows then «и ещё N»; useTranslation → t; no
 * tailwind-merge (cn from vk/cn).
 */
// Source: packages/ui/src/components/IssueRelationshipsSection.tsx and
// packages/ui/src/components/RelationshipBadge.tsx
import { useMemo, useState, type ReactNode } from 'react';
import { t } from '../../i18n';
import { blockerIds, buildWaitersIndex, milestoneOf, titleStartsWithTag } from '../../lib/waitReasons';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { cn } from '../cn';

export const RELATIONSHIP_ROWS = 2;

type DisplayType = 'blocks' | 'blocked_by' | 'part_of' | 'related';

interface Row {
  id: string;
  displayType: DisplayType;
  tag: string | null;
  title: string;
}

// vk-1to1: the canvas icons (Main right panel). «блокирует» and «ждёт» are the
// red bend arrow; «связана» and «часть» the low two-way arrow.
function BendArrow() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 13V9.5A3.5 3.5 0 0 1 6.5 6H13M10 3l3 3-3 3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SwapArrow() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 5.5h11M11 3l2.5 2.5L11 8M13.5 10.5h-11M5 8l-2.5 2.5L5 13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const LABELS = { blocks: 'blocks', blocked_by: 'waits on', part_of: 'part of', related: 'related' } as const;
const RED: ReadonlySet<DisplayType> = new Set(['blocks', 'blocked_by']);

/** Blocker tags (milestone, else id) for the «ждёт: …» summary. */
export function blockerTags(bead: SupervisorBead, items: readonly SupervisorBead[]): string[] {
  const byId = new Map(items.map((b) => [b.id, b]));
  return blockerIds(bead).map((id) => {
    const b = byId.get(id);
    return (b && milestoneOf(b)) ?? id;
  });
}

function RelationshipBadge({
  row,
  onClick,
}: {
  row: Row;
  onClick?: (id: string) => void;
}) {
  const red = RED.has(row.displayType);
  const label = t(LABELS[row.displayType]);
  const body = (
    <>
      <span className={cn('flex shrink-0', red ? 'text-vk-error' : 'text-vk-text-low')}>
        {red ? <BendArrow /> : <SwapArrow />}
      </span>
      <span className="shrink-0 whitespace-nowrap text-sm text-vk-text-low">{label}</span>
      {row.tag !== null && (
        <span className="shrink-0 whitespace-nowrap font-vk-mono text-sm text-vk-text-normal">{row.tag}</span>
      )}
      <span className="min-w-0 truncate text-base text-vk-text-high">{row.title}</span>
    </>
  );
  const cls = 'flex min-h-11 md:min-h-0 w-full min-w-0 items-center gap-1.5 py-1 text-left';
  return onClick ? (
    <button
      type="button"
      className={cn(cls, 'rounded-sm hover:bg-vk-bg-secondary focus-mark')}
      onClick={() => onClick(row.id)}
    >
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export interface RelationshipsProps {
  bead: SupervisorBead;
  /** The shared board read (useBoardData); empty while it loads. */
  items: readonly SupervisorBead[];
  onOpenBead?: (beadId: string) => void;
  /** Other linked things (sessions, PRs, runs), shown in this same section. */
  children?: ReactNode;
  /** True when `children` shows something (review M-3: else «Связей нет.»). */
  hasOtherLinks?: boolean;
}

/** The card's parent (`parent`, else a parent-child dependency). */
function parentOf(bead: SupervisorBead): string | null {
  if (typeof bead.parent === 'string' && bead.parent.length > 0) return bead.parent;
  const dep = (bead.dependencies ?? []).find((d) => d.type === 'parent-child' && d.issue_id === bead.id);
  return dep?.depends_on_id ?? null;
}

// polish2 16.11 (owner, item 8): «Связи» is the ONE relations section of the
// card: what it waits on, what waits on it, what it is part of, and (children)
// the other linked things. The old «Зависимости» and «Связанное» are gone.
export function Relationships({ bead, items, onOpenBead, children, hasOtherLinks = false }: RelationshipsProps) {
  const [all, setAll] = useState(false);
  const { rows, extra, total } = useMemo(() => {
    const byId = new Map(items.map((b) => [b.id, b]));
    const waitersOf = buildWaitersIndex(items);
    const toRow = (id: string, displayType: DisplayType): Row => {
      const b = byId.get(id);
      const tag = b ? milestoneOf(b) : null;
      const title = b?.title ?? id;
      return { id, displayType, tag: tag !== null && titleStartsWithTag(title, tag) ? null : tag, title };
    };
    const parent = parentOf(bead);
    const every: Row[] = [
      ...(waitersOf.get(bead.id) ?? []).map((id) => toRow(id, 'blocks')),
      ...blockerIds(bead)
        .filter((id) => id !== parent)
        .map((id) => toRow(id, 'blocked_by')),
      ...(parent === null ? [] : [toRow(parent, 'part_of')]),
      ...(bead.dependencies ?? [])
        .filter((d) => d.type === 'related' && d.issue_id === bead.id && d.depends_on_id !== parent)
        .map((d) => toRow(d.depends_on_id, 'related')),
    ];
    // the parent stays visible even when the waiters fold
    const head = every.slice(0, RELATIONSHIP_ROWS);
    const parentRow = every.find((r) => r.displayType === 'part_of');
    const shown = all
      ? every
      : parentRow !== undefined && !head.includes(parentRow)
        ? [...head, parentRow]
        : head;
    return {
      rows: shown,
      extra: Math.max(0, every.length - shown.length),
      total: every.length,
    };
  }, [bead, items, all]);

  return (
    <section data-testid="task-relationships" className="flex flex-col gap-1">
      <div className="flex items-center justify-between py-1">
        <h3 className="text-sm font-medium text-vk-text-high">{t('Relationships')}</h3>
        {total > 0 && <span className="text-sm text-vk-text-low">{total}</span>}
      </div>
      {rows.length === 0 && !hasOtherLinks ? (
        <p className="py-1 text-sm text-vk-text-low">{t('No links.')}</p>
      ) : (
        rows.map((row) => (
          <RelationshipBadge
            key={`${row.displayType}:${row.id}`}
            row={row}
            {...(onOpenBead !== undefined ? { onClick: onOpenBead } : {})}
          />
        ))
      )}
      {extra > 0 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="min-h-11 self-start rounded-sm pl-[21px] pt-1 text-left text-sm text-vk-text-low hover:text-vk-text-high focus-mark md:min-h-0"
        >
          {t('and {n} more', { n: extra })}
        </button>
      )}
      {children}
    </section>
  );
}
