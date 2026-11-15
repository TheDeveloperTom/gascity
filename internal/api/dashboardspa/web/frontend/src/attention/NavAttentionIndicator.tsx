import type { AttentionDomainSummary, BadgeSeverity } from './compose';

// Signal count pill on a nav item: Stop red when anything in the domain
// needs the owner, Lamp amber when it only needs watching. The text is the
// number alone; the aria-label carries the full sentence. Hidden at zero.
export function NavAttentionIndicator({
  label,
  summary,
}: {
  label: string;
  summary: AttentionDomainSummary;
}) {
  const total = summary.attention + summary.watch;
  if (total === 0 || summary.severity === null) return null;
  const itemWord = total === 1 ? 'item' : 'items';

  return (
    <span
      aria-label={`${label}: ${total} ${summary.severity} ${itemWord}`}
      className={`ml-auto inline-flex min-w-[1.375rem] justify-center rounded-full px-1.5 text-label font-semibold tnum ${severityClass(summary.severity)}`}
    >
      {total}
    </span>
  );
}

function severityClass(severity: BadgeSeverity): string {
  return severity === 'attention' ? 'bg-accent text-on-primary' : 'bg-warn text-on-primary';
}
