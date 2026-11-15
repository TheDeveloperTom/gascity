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
 * `title` carries the full related title.
 */
// Source: vibe-kanban packages/ui/src/components/RelationshipBadge.tsx

import {
  ArrowBendUpRightIcon,
  ArrowsLeftRightIcon,
  CopyIcon,
  ProhibitIcon,
} from '@phosphor-icons/react';
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

const RELATIONSHIP_ICONS = {
  blocks: ArrowBendUpRightIcon,
  blocked_by: ProhibitIcon,
  related: ArrowsLeftRightIcon,
  duplicate_of: CopyIcon,
  duplicated_by: CopyIcon,
} as const;

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
  const Icon = RELATIONSHIP_ICONS[displayType];
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
        isBlocking ? 'bg-accent/10 text-accent' : 'bg-vk-bg-panel text-vk-text-low',
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" weight="bold" aria-hidden="true" />
      <span className="truncate">
        {compact ? relatedIssueDisplayId : `${label} ${relatedIssueDisplayId}`}
      </span>
    </span>
  );
}
