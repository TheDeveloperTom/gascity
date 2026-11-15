import { useId } from 'react';
import { Link } from 'react-router';
import { t } from '../../i18n';
import { waitCauseText, type IdleExplanation, type WaitCause } from '../../lib/waitReasons';

// When Working, Review and PR are all empty, one notice says why (RB7): one
// sentence per cause, each with its links, read from the city's own data.
// A partial window says it cannot tell instead of guessing.

const LINK =
  'rounded-sm text-fg underline underline-offset-2 focus-mark [overflow-wrap:anywhere] hover:text-primary';

function CauseLinks({ cause }: { cause: WaitCause }) {
  const blocker =
    cause.kind === 'card' ? (
      <Link to={`/beads?bead=${encodeURIComponent(cause.blocker.id)}`} className={LINK}>
        {cause.blocker.title ?? cause.blocker.id}
      </Link>
    ) : null;
  const runHref = cause.kind === 'card' || cause.kind === 'queue' ? cause.runHref : null;
  if (blocker === null && runHref === null) return null;
  return (
    <span className="mt-1 flex flex-col gap-1">
      {blocker}
      {runHref !== null && (
        <Link to={runHref} className={LINK}>
          {t('Open the run')}
        </Link>
      )}
    </span>
  );
}

export function IdleNotice({ idle }: { idle: Exclude<IdleExplanation, { state: 'busy' }> }) {
  const headingId = useId();
  if (idle.state === 'unknown') {
    return (
      <div data-idle="unknown" className="rounded-md border border-rule bg-surface-raised p-4">
        <p className="text-body text-warn">
          {t('The board read only part of the tasks, so it cannot tell who is working.')}
        </p>
      </div>
    );
  }
  return (
    <section
      aria-labelledby={headingId}
      data-idle="idle"
      className="rounded-md border border-rule bg-surface-raised p-4"
    >
      <h3 id={headingId} className="text-title font-semibold text-fg">
        {t('Nobody is working right now.')}
      </h3>
      {idle.causes.length === 0 ? (
        <p className="mt-2 text-body text-fg-muted">{t('No reason found in the board data.')}</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {idle.causes.map((cause, index) => (
            <li key={index} className="text-body text-fg">
              <p className="[overflow-wrap:anywhere]">{waitCauseText(cause)}</p>
              <CauseLinks cause={cause} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
