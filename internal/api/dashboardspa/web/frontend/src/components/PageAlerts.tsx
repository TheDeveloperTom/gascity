// Page-level error lines, one under the page header rather than inside its
// meta cluster (DESIGN-PLAN §7 "Header errors"). Each message is its own
// alert so a screen reader announces every failure and none hides another.

interface PageAlertsProps {
  messages: ReadonlyArray<string | null | undefined>;
}

export function PageAlerts({ messages }: PageAlertsProps) {
  const lines = messages.filter((m): m is string => typeof m === 'string' && m.trim() !== '');
  if (lines.length === 0) return null;
  return (
    <div className="mb-4 space-y-1 rounded-md bg-accent/[0.06] px-3 py-2">
      {lines.map((message, i) => (
        <p key={`${i}:${message}`} role="alert" className="text-body text-accent">
          {message}
        </p>
      ))}
    </div>
  );
}
