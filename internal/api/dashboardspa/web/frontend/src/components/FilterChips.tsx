// FilterChips: toggle chips. On is a blue chip (you pressed it), off is a
// hairline outline. aria-pressed carries the state for assistive tech, the
// blue fill carries it for the eye; the word itself never changes.

interface ChipDef {
  id: string;
  label: string;
}

interface FilterChipsProps {
  chips: ReadonlyArray<ChipDef>;
  activeIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** Optional leading label, e.g. "Status". */
  legend?: string;
}

export function FilterChips({ chips, activeIds, onToggle, legend }: FilterChipsProps) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {legend && <span className="mr-1 text-label font-medium text-fg-muted">{legend}</span>}
      {chips.map((chip) => {
        const active = activeIds.has(chip.id);
        return (
          <button
            key={chip.id}
            type="button"
            onClick={() => onToggle(chip.id)}
            aria-pressed={active}
            className={`h-8 rounded-full border px-3 text-label font-medium transition-colors duration-150 ease-out-quart focus-mark ${
              active
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-rule bg-surface-raised text-fg-muted hover:text-fg'
            }`}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
