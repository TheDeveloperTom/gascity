import { t, tn } from '../i18n';

// Signal count pills on a nav item (ruling R4, OWNER-HOME-PLAN Task 9). Red
// counts only what waits for the owner (the owner slice), so the red pills add
// up to the Home plate and the phone chip. The city's own trouble gets one
// amber count, on Health only. Each pill's text is the number alone; its
// aria-label carries the full sentence. Hidden at zero.
export function NavAttentionIndicator({
  label,
  ownerCount,
  cityCount = 0,
}: {
  /** The English nav label (the i18n key). */
  label: string;
  ownerCount: number;
  cityCount?: number;
}) {
  if (ownerCount + cityCount === 0) return null;
  const shown = t(label);

  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1">
      {ownerCount > 0 && (
        <CountPill
          count={ownerCount}
          tone="owner"
          aria={tn(
            ownerCount,
            { one: '{label}: {n} attention item', other: '{label}: {n} attention items' },
            { label: shown },
          )}
        />
      )}
      {cityCount > 0 && (
        <CountPill
          count={cityCount}
          tone="city"
          aria={tn(
            cityCount,
            { one: '{label}: {n} city issue', other: '{label}: {n} city issues' },
            { label: shown },
          )}
        />
      )}
    </span>
  );
}

function CountPill({ count, tone, aria }: { count: number; tone: 'owner' | 'city'; aria: string }) {
  return (
    <span
      aria-label={aria}
      className={`inline-flex min-w-[1.375rem] justify-center rounded-full px-1.5 text-label font-semibold tnum ${
        tone === 'owner' ? 'bg-accent text-on-primary' : 'bg-warn text-on-primary'
      }`}
    >
      {count}
    </span>
  );
}
