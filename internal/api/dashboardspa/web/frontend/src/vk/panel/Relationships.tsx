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
import { ArrowBendUpRightIcon, ProhibitIcon, TreeStructureIcon } from '@phosphor-icons/react';
import { useMemo, useState, type ReactNode } from 'react';
import { t } from '../../i18n';
import { transitiveWaiters } from '../../lib/holds';
import { blockerIds, buildWaitersIndex, milestoneOf, titleStartsWithTag } from '../../lib/waitReasons';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { cn } from '../cn';

export const RELATIONSHIP_ROWS = 2;

type DisplayType = 'blocks' | 'blocked_by' | 'part_of';

interface Row {
  id: string;
  displayType: DisplayType;
  tag: string | null;
  title: string;
}

const ICONS = { blocks: ArrowBendUpRightIcon, blocked_by: ProhibitIcon, part_of: TreeStructureIcon } as const;
const LABELS = { blocks: 'blocks', blocked_by: 'waits on', part_of: 'part of' } as const;

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
  const Icon = ICONS[row.displayType];
  const label = t(LABELS[row.displayType]);
  const body = (
    <>
      <span className={cn('flex shrink-0', row.displayType === 'part_of' ? 'text-vk-text-low' : 'text-vk-error')}>
        <Icon size={15} weight="bold" aria-hidden="true" />
      </span>
      <span className="shrink-0 whitespace-nowrap text-vk-text-low">{label}</span>
      {row.tag !== null && (
        <span className="shrink-0 whitespace-nowrap font-vk-mono text-vk-text-high">{row.tag}</span>
      )}
      <span className="min-w-0 truncate text-vk-text-normal">{row.title}</span>
    </>
  );
  const cls = 'flex min-h-11 md:min-h-[32px] w-full min-w-0 items-center gap-1.5 py-1 text-left text-sm';
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
  const { rows, extra, holds } = useMemo(() => {
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
      holds: transitiveWaiters(bead.id, waitersOf).length,
    };
  }, [bead, items, all]);

  return (
    <section data-testid="task-relationships" className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between py-1">
        <h3 className="text-sm font-medium text-vk-text-high">{t('Relationships')}</h3>
        {holds > 0 && (
          <span className="text-sm text-vk-text-low">{t('holds {n}', { n: holds })}</span>
        )}
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
