import type { ChangeEvent } from 'react';
import { Icon } from './icons';

// A boxed search field with a magnifier and, while typing, the match count
// at the right edge. The placeholder reads as an instruction.

interface ListSearchBarProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Visible row count after filtering, for the count at the right. */
  matchCount?: number;
  /** Total row count before filtering, for context. */
  totalCount?: number;
  ariaLabel?: string;
}

export function ListSearchBar({
  value,
  onChange,
  placeholder = 'Search',
  matchCount,
  totalCount,
  ariaLabel = 'Search list',
}: ListSearchBarProps) {
  const showCount =
    value.length > 0 && typeof matchCount === 'number' && typeof totalCount === 'number';

  return (
    <div className="relative">
      <Icon
        name="search"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint"
      />
      <input
        type="search"
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="h-10 w-full rounded border border-rule bg-surface-raised pl-9 pr-16 text-body text-fg placeholder:text-fg-faint focus-mark"
      />
      {showCount && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-label text-fg-faint tnum">
          {matchCount} / {totalCount}
        </span>
      )}
    </div>
  );
}
