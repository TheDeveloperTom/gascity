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
 * Modified for the Gas City dashboard: labels go through our `t`; VK tokens
 * map to the --vk-* aliases (error → accent, our nearest red); the onClick /
 * keyboard role is dropped (the board opens the card, not the relation); a
 * `title` carries the full related title. vk11 (16.11): the canvas's own
 * icons replace phosphor's; on the card the chip is `compact` (icon + short
 * label, no «ждёт:» prefix).
 */
// Source: vibe-kanban packages/ui/src/components/RelationshipBadge.tsx

import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { cn } from '../cn';

export type RelationshipDisplayType =
  | 'blocks'
  | 'blocked_by'
  | 'related'
  | 'duplicate_of'
  | 'duplicated_by';

export interface RelationshipBadgeProps {
  displayType: RelationshipDisplayType;
  relatedIssueDisplayId: string;
  compact?: boolean;
  className?: string;
  title?: string;
}

// The canvas's own 15 px icons (Cards / Main 15.11): ⊘ waits for, ↱ blocks,
// ⇄ related (replaces VK's phosphor set; vk11 card lane).
const STROKE = { stroke: 'currentColor', strokeWidth: 1.6 } as const;
const DUPLICATE = <rect x="3" y="3" width="10" height="10" rx="1.5" {...STROKE} />;
const ICON_PATHS: Readonly<Record<RelationshipDisplayType, ReactNode>> = {
  blocked_by: (
    <>
      <circle cx="8" cy="8" r="5.6" {...STROKE} />
      <path d="M4 4l8 8" {...STROKE} />
    </>
  ),
  blocks: (
    <path
      d="M3 13V9.5A3.5 3.5 0 0 1 6.5 6H13M10 3l3 3-3 3"
      {...STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  related: (
    <path
      d="M2.5 5.5h11M11 3l2.5 2.5L11 8M13.5 10.5h-11M5 8l-2.5 2.5L5 13"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  duplicate_of: DUPLICATE,
  duplicated_by: DUPLICATE,
};

function getRelationshipLabel(displayType: RelationshipDisplayType): string {
  switch (displayType) {
    case 'blocks':
      return t('blocks:');
    case 'blocked_by':
      return t('waits for:');
    case 'related':
      return 'related';
    case 'duplicate_of':
      return 'dup of';
    case 'duplicated_by':
      return 'dup';
  }
}

export function RelationshipBadge({
  displayType,
  relatedIssueDisplayId,
  compact,
  className,
  title,
}: RelationshipBadgeProps) {
  const label = getRelationshipLabel(displayType);
  const isBlocking = displayType === 'blocks' || displayType === 'blocked_by';

  return (
    <span
      title={title}
      data-relationship={displayType}
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1',
        'h-5 px-1',
        'rounded-sm',
        'text-sm font-medium',
        'whitespace-nowrap',
        isBlocking ? 'bg-vk-error/10 text-vk-error' : 'bg-vk-bg-panel text-vk-text-low',
        className,
      )}
    >
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
        {ICON_PATHS[displayType]}
      </svg>
      <span className="truncate">
        {compact ? relatedIssueDisplayId : `${label} ${relatedIssueDisplayId}`}
      </span>
    </span>
  );
}
