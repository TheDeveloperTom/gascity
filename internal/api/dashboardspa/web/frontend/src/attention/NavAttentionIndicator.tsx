import type { AttentionDomainSummary, BadgeSeverity } from './compose';

// Signal count pills on a nav item. "Needs you" means one number everywhere
// (ruling C1, final review I-2): the Stop-red pill counts only attention
// items, so the red pills add up to the Home board headline. Watch items get
// their own Lamp-amber pill beside it. Each pill's text is the number alone;
// its aria-label carries the full sentence. Hidden at zero.
export function NavAttentionIndicator({
  label,
  summary,
}: {
  label: string;
  summary: AttentionDomainSummary;
}) {
  if (summary.attention + summary.watch === 0 || summary.severity === null) return null;

  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1">
      {summary.attention > 0 && (
        <CountPill label={label} count={summary.attention} severity="attention" />
      )}
      {summary.watch > 0 && <CountPill label={label} count={summary.watch} severity="watch" />}
    </span>
  );
}

function CountPill({
  label,
  count,
  severity,
}: {
  label: string;
  count: number;
  severity: BadgeSeverity;
}) {
  const itemWord = count === 1 ? 'item' : 'items';
  return (
    <span
      aria-label={`${label}: ${count} ${severity} ${itemWord}`}
      className={`inline-flex min-w-[1.375rem] justify-center rounded-full px-1.5 text-label font-semibold tnum ${severityClass(severity)}`}
    >
      {count}
    </span>
  );
}

function severityClass(severity: BadgeSeverity): string {
  return severity === 'attention' ? 'bg-accent text-on-primary' : 'bg-warn text-on-primary';
}
