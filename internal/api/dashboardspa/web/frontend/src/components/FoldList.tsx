import { Fragment, useId, useState, type ReactNode } from 'react';
import { Button } from './Button';

// Show less, reveal on demand (DESIGN-PLAN R8, §9.5). A list shows its first
// `limit` items, then one toggle unfolds the rest. Local UI state only: the
// fold resets on every visit and is never persisted. Each `renderItem` result
// must be an <li>; the list itself is a <ul> taking `className`.

interface FoldListProps<T> {
  items: readonly T[];
  limit: number;
  itemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  showLabel?: (total: number) => string;
  hideLabel?: string;
  className?: string;
}

const defaultShowLabel = (total: number) => `Show all ${total}`;

export function FoldList<T>({
  items,
  limit,
  itemKey,
  renderItem,
  showLabel = defaultShowLabel,
  hideLabel = 'Show fewer',
  className = '',
}: FoldListProps<T>) {
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;

  const foldable = items.length > limit;
  const visible = foldable && !expanded ? items.slice(0, Math.max(0, limit)) : items;

  return (
    <>
      {visible.length > 0 && (
        <ul id={listId} className={className}>
          {visible.map((item) => (
            <Fragment key={itemKey(item)}>{renderItem(item)}</Fragment>
          ))}
        </ul>
      )}
      {foldable && (
        <div className="px-1 py-1.5">
          <Button
            size="sm"
            tone="quiet"
            aria-expanded={expanded}
            {...(visible.length > 0 ? { 'aria-controls': listId } : {})}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? hideLabel : showLabel(items.length)}
          </Button>
        </div>
      )}
    </>
  );
}
