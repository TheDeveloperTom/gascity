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
 * Modified for the Gas City dashboard: VK tokens mapped to ours (error →
 * accent, brand → vk-brand, success → ok); `priorityLevelOf` maps the bead's
 * numeric priority (0 urgent … 3+ low); the icon carries a title + label.
 */
// Source: vibe-kanban packages/ui/src/components/PriorityIcon.tsx

import { ArrowDownIcon, ArrowFatLineUpIcon, ArrowUpIcon, MinusIcon } from '@phosphor-icons/react';
import { t } from '../../i18n';
import { cn } from '../cn';

export type PriorityLevel = 'urgent' | 'high' | 'medium' | 'low';

export interface PriorityIconProps {
  priority: PriorityLevel | null;
  className?: string;
}

const priorityConfig: Record<PriorityLevel, { icon: typeof ArrowUpIcon; colorClass: string }> = {
  urgent: { icon: ArrowFatLineUpIcon, colorClass: 'text-vk-error' },
  high: { icon: ArrowUpIcon, colorClass: 'text-vk-brand' },
  medium: { icon: MinusIcon, colorClass: 'text-vk-text-low' },
  low: { icon: ArrowDownIcon, colorClass: 'text-vk-success' },
};

/** A bead's numeric priority (0 = most urgent) as a VK level; null when unset. */
export function priorityLevelOf(priority: number | null | undefined): PriorityLevel | null {
  if (priority === null || priority === undefined) return null;
  if (priority <= 0) return 'urgent';
  if (priority === 1) return 'high';
  if (priority === 2) return 'medium';
  return 'low';
}

export const PriorityIcon = ({ priority, className }: PriorityIconProps) => {
  if (!priority) return null;
  const { icon: IconComponent, colorClass } = priorityConfig[priority];
  const label = t('Priority: {level}', { level: t(`priority ${priority}`) });
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex">
      <IconComponent className={cn('h-3.5 w-3.5', colorClass, className)} weight="bold" />
    </span>
  );
};
