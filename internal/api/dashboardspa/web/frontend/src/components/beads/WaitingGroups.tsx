import { useId, type ReactNode } from 'react';
import type { BoardCard, WaitingGroup } from '../../lib/boardModel';

// Waiting by stage (RB4): the owner thinks in stages, so a big Waiting folds
// into one row per stage (M03, M04, …) with its count. Open groups come from
// the caller, keyed by data (`milestone:M04`), never by translated names.
// Without `fold` every group is open under a plain heading.

interface WaitingGroupsProps {
  groups: readonly WaitingGroup[];
  fold: boolean;
  openGroups: ReadonlySet<string>;
  onToggleGroup: (key: string) => void;
  renderCard: (card: BoardCard) => ReactNode;
}

const LIST = 'ml-2 border-l border-rule pl-3';

function GroupLabel({ group }: { group: WaitingGroup }) {
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-display text-[1.0625rem] font-bold leading-[1.375rem] text-fg [overflow-wrap:anywhere]">
          {group.name}
        </span>
        {group.subtitle !== null && (
          <span className="line-clamp-1 text-label text-fg-muted">{group.subtitle}</span>
        )}
      </span>
      <span className="ml-auto shrink-0 text-label font-semibold tnum text-fg-muted">
        {group.cards.length}
      </span>
    </>
  );
}

function FoldedGroup({
  group,
  open,
  onToggle,
  renderCard,
}: {
  group: WaitingGroup;
  open: boolean;
  onToggle: () => void;
  renderCard: (card: BoardCard) => ReactNode;
}) {
  const listId = useId();
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={onToggle}
        className="flex w-full items-start gap-2 rounded px-1 py-2 text-left focus-mark hover:bg-surface-tint"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className={`mt-1.5 h-3 w-3 shrink-0 text-fg-muted ${open ? 'rotate-90' : ''}`}
        >
          <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.75" />
        </svg>
        <GroupLabel group={group} />
      </button>
      {open && (
        <ul id={listId} className={LIST}>
          {group.cards.map((card) => renderCard(card))}
        </ul>
      )}
    </li>
  );
}

export function WaitingGroups({
  groups,
  fold,
  openGroups,
  onToggleGroup,
  renderCard,
}: WaitingGroupsProps) {
  if (groups.length === 0) return null;
  if (fold) {
    return (
      <ul className="divide-y divide-rule">
        {groups.map((group) => (
          <FoldedGroup
            key={group.key}
            group={group}
            open={openGroups.has(group.key)}
            onToggle={() => onToggleGroup(group.key)}
            renderCard={renderCard}
          />
        ))}
      </ul>
    );
  }
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.key}>
          <h4 className="flex items-start gap-2 px-1 py-1">
            <GroupLabel group={group} />
          </h4>
          <ul className={LIST}>{group.cards.map((card) => renderCard(card))}</ul>
        </div>
      ))}
    </div>
  );
}
