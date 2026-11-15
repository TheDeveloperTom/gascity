import { useId, useState } from 'react';
import { Link } from 'react-router';
import type { AttentionItem, OwnerReadiness } from '../../attention/compose';
import { t, tn } from '../../i18n';
import { MAYOR_QUESTIONS_ON_BOARD } from '../../lib/constants';
import { ExternalLink } from '../../vk/ExternalLink';
// Task 6: an Activity reader (Richard) sees no answer action.
import { canWrite } from '../../embed/activitySession';

// The owner plate (review §4): an enamel street plate, the one loud thing on
// Home. It answers one question, "does anything wait for me", in one sentence,
// then lists only what waits for the owner (R3). The all-clear needs both
// owner reads to have completed (R12): loading and failure say so instead.
// No role="alert": the headline is the page's first heading.

const ACTION =
  'focus-mark inline-flex h-9 shrink-0 items-center justify-center rounded border border-on-plate/90 px-4 text-body font-semibold text-on-plate transition-colors duration-150 ease-out-quart hover:bg-on-plate/10';

/** Rows on the plate before «Ещё N» (task5-cap). */
export const PLATE_VISIBLE = 5;

function isCounted(item: AttentionItem): boolean {
  return item.severity !== 'unavailable';
}

function headlineFor(counted: number, readiness: OwnerReadiness): string {
  if (counted > 0) {
    return tn(counted, { one: '{n} thing waits for you', other: '{n} things wait for you' });
  }
  if (readiness.state === 'loading') return t('Checking whether anything waits for you…');
  if (readiness.state === 'degraded') {
    return t('Could not check: {reasons}.', {
      reasons: readiness.reasons.map((r) => t(r)).join(', '),
    });
  }
  return t('Nothing waits for you right now.');
}

export function OwnerPlate({
  items,
  readiness,
  questionsOnBoard = MAYOR_QUESTIONS_ON_BOARD,
}: {
  items: readonly AttentionItem[];
  readiness: OwnerReadiness;
  questionsOnBoard?: boolean;
}) {
  const baseId = useId();
  const [expanded, setExpanded] = useState(false);
  const headingId = `${baseId}-headline`;
  const counted = items.filter(isCounted);
  const rows = [...counted, ...items.filter((item) => !isCounted(item))];
  // task5-cap: a long queue (48 on test data) must not make Home endless. The
  // headline keeps the full count; the rest unfolds in place, since owner
  // items span beads, mail and agents and no single page lists them all.
  const foldable = rows.length > PLATE_VISIBLE;
  const shown = foldable && !expanded ? rows.slice(0, PLATE_VISIBLE) : rows;
  const headline = headlineFor(counted.length, readiness);
  const allClear = counted.length === 0 && readiness.state === 'ready';
  // With items on the plate, a failed read still has to be named.
  const degradedNote =
    counted.length > 0 && readiness.state === 'degraded'
      ? t('Could not check: {reasons}.', {
          reasons: readiness.reasons.map((r) => t(r)).join(', '),
        })
      : null;

  return (
    <section
      aria-labelledby={headingId}
      data-readiness={readiness.state}
      className="mb-10 rounded-plate bg-plate text-on-plate ring-2 ring-inset ring-on-plate/90"
    >
      <div className="px-5 pb-4 pt-5 sm:px-6">
        <h2
          id={headingId}
          className="font-display text-[2rem] font-bold leading-[1.1] [overflow-wrap:anywhere] sm:text-[2.5rem]"
        >
          {headline}
        </h2>
        {allClear && (
          <p className="mt-1 text-body text-on-plate-muted">
            {t('The city is running on its own.')}
          </p>
        )}
        {degradedNote !== null && (
          <p className="mt-1 text-body text-on-plate-muted [overflow-wrap:anywhere]">
            {degradedNote}
          </p>
        )}
        {!questionsOnBoard && (
          <p className="mt-1 text-body text-on-plate-muted">
            {t('Questions from the Mayor arrive in the chat.')}
          </p>
        )}
      </div>

      {rows.length > 0 && (
        <ul className="divide-y divide-on-plate/25 border-t border-on-plate/25">
          {shown.map((item, index) => {
            const titleId = `${baseId}-item-${index}`;
            const muted = !isCounted(item);
            return (
              <li
                key={`${item.domain}:${item.id}`}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:gap-6 sm:px-6"
              >
                <div className="min-w-0 flex-1">
                  <p
                    id={titleId}
                    className={`text-[1.0625rem] font-semibold leading-snug [overflow-wrap:anywhere] ${muted ? 'text-on-plate-muted' : 'text-on-plate'}`}
                  >
                    {item.title}
                  </p>
                  {(item.summary !== undefined || item.ref !== undefined) && (
                    <p className="mt-1 flex flex-wrap items-baseline gap-x-3 text-body text-on-plate-muted [overflow-wrap:anywhere]">
                      {item.summary !== undefined && <span>{item.summary}</span>}
                      {item.ref !== undefined && (
                        <span className="font-mono text-label">{item.ref}</span>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {item.externalHref !== undefined && canWrite() && (
                    <ExternalLink
                      href={item.externalHref}
                      aria-describedby={titleId}
                      className={ACTION}
                    >
                      {t('Answer in chat')}
                    </ExternalLink>
                  )}
                  {item.href !== undefined && (
                    <Link to={item.href} aria-describedby={titleId} className={ACTION}>
                      {t('Open')}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {foldable && (
        <div className="border-t border-on-plate/25 px-5 py-3 sm:px-6">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
            className={ACTION}
          >
            {expanded ? t('Show fewer') : t('Show {n} more', { n: rows.length - PLATE_VISIBLE })}
          </button>
        </div>
      )}
    </section>
  );
}
