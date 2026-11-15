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
 * Modified for the Gas City dashboard: VK tokens mapped to the --vk-* aliases;
 * `color` is a full CSS colour (VK took an HSL triple); a `tone="error"` badge
 * (the design's «срочно» / «стоит N ч» pill) is added.
 */
// Source: vibe-kanban packages/ui/src/components/KanbanBadge.tsx

import type { ReactNode } from 'react';
import { cn } from '../cn';

export type KanbanBadgeProps = {
  name: ReactNode;
  color?: string;
  tone?: 'default' | 'error';
  className?: string;
  title?: string;
};

export const KanbanBadge = ({ name, color, tone = 'default', className, title }: KanbanBadgeProps) => {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center justify-center',
        'h-5 gap-1',
        tone === 'error' ? 'bg-vk-error/10 px-1.5 text-vk-error' : 'bg-vk-bg-panel px-2 text-vk-text-low',
        'rounded-sm',
        'text-sm font-medium',
        'whitespace-nowrap',
        className,
      )}
    >
      {color && (
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      )}
      {name}
    </span>
  );
};
