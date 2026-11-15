import { Fragment, useId } from 'react';
import { Link } from 'react-router';
import type {
  AttentionItem,
  AttentionOverflowGroup,
  AttentionSeverity,
} from '../../attention/compose';
import { attentionDomainHref, attentionDomainLabel } from '../../attention/labels';
import { StatusShape } from '../icons';
import { StatusBadge, type StatusTone } from '../StatusBadge';

// The Home signal board (DESIGN-PLAN §2, §6.2): the one loud thing in the
// dashboard. A plain sentence answers "does anything need me", set large on a
// red, amber or green band, then the items as big rows with one `Open` each.
// `unavailable` items report degraded data: they list in grey under the
// counted ones and never raise the count or colour the band. No role="alert":
// a healthy Home must carry none, and the sentence is the page's first heading.

type Signal = 'attention' | 'watch' | 'clear';

const SEVERITY_TONE: Record<AttentionSeverity, StatusTone> = {
  attention: 'stuck',
  watch: 'warn',
  unavailable: 'neutral',
};

const SIGNAL_TONE: Record<Signal, StatusTone> = {
  attention: 'stuck',
  watch: 'warn',
  clear: 'ok',
};

const BAND: Record<Signal, string> = {
  attention: 'border-accent/40',
  watch: 'border-warn/40',
  clear: 'border-ok/40',
};

const BAND_FILL: Record<Signal, string> = {
  attention: 'bg-accent/[0.08]',
  watch: 'bg-warn/[0.10]',
  clear: 'bg-ok/[0.08]',
};

const SHAPE_COLOR: Record<Signal, string> = {
  attention: 'text-accent',
  watch: 'text-warn',
  clear: 'text-ok',
};

function isCounted(item: AttentionItem): boolean {
  return item.severity === 'attention' || item.severity === 'watch';
}

export function NeedsYouBoard({
  items,
  overflow,
}: {
  items: readonly AttentionItem[];
  overflow: readonly AttentionOverflowGroup[];
}) {
  const baseId = useId();
  const counted = items.filter(isCounted);
  const degraded = items.filter((item) => !isCounted(item));
  const overflowCounted = overflow.reduce((sum, group) => sum + group.attention + group.watch, 0);
  const total = counted.length + overflowCounted;
  const signal: Signal =
    counted.some((item) => item.severity === 'attention') ||
    overflow.some((group) => group.attention > 0)
      ? 'attention'
      : total > 0
        ? 'watch'
        : 'clear';
  const headline =
    total === 0
      ? 'Nothing needs you right now.'
      : total === 1
        ? '1 thing needs you'
        : `${total} things need you`;
  const rows = [...counted, ...degraded];

  return (
    <section
      aria-labelledby="needs-you-title"
      data-signal={signal}
      className={`mb-10 overflow-hidden rounded-lg border bg-surface-raised ${BAND[signal]}`}
    >
      <div
        className={`flex items-center gap-3 px-5 ${rows.length > 0 ? 'py-5' : 'py-6'} ${BAND_FILL[signal]}`}
      >
        <span
          aria-hidden="true"
          className={`flex shrink-0 ${SHAPE_COLOR[signal]} [&>svg]:h-4 [&>svg]:w-4 sm:[&>svg]:h-5 sm:[&>svg]:w-5`}
        >
          <StatusShape tone={SIGNAL_TONE[signal]} />
        </span>
        <h2
          id="needs-you-title"
          className="text-[1.75rem] font-semibold leading-tight text-fg sm:text-display"
        >
          {headline}
        </h2>
      </div>

      {rows.length > 0 && (
        <ul className="divide-y divide-rule border-t border-rule">
          {rows.map((item, index) => {
            const titleId = `${baseId}-item-${index}`;
            const muted = !isCounted(item);
            return (
              <li
                key={`${item.domain}:${item.id}`}
                className="flex flex-col gap-2 px-5 py-4 sm:grid sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-start sm:gap-x-4"
              >
                <span className="sm:pt-0.5">
                  <StatusBadge
                    tone={SEVERITY_TONE[item.severity]}
                    label={attentionDomainLabel(item.domain)}
                  />
                </span>
                <div className="min-w-0">
                  <p
                    id={titleId}
                    className={`text-title font-semibold [overflow-wrap:anywhere] ${muted ? 'text-fg-muted' : 'text-fg'}`}
                  >
                    {item.title}
                  </p>
                  {item.summary && (
                    <p className="mt-0.5 text-body text-fg-muted [overflow-wrap:anywhere]">
                      {item.summary}
                    </p>
                  )}
                </div>
                {item.href !== undefined && (
                  <Link
                    to={item.href}
                    aria-describedby={titleId}
                    className="focus-mark inline-flex h-9 items-center justify-center self-start rounded border border-rule bg-surface-raised px-4 text-body font-semibold text-primary transition-colors duration-150 ease-out-quart hover:bg-surface-tint"
                  >
                    Open
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {overflow.length > 0 && (
        <p className="border-t border-rule px-5 py-3 text-body text-fg-muted">
          More:{' '}
          {overflow.map((group, index) => (
            <Fragment key={group.domain}>
              {index > 0 && ', '}
              <Link
                to={attentionDomainHref(group.domain)}
                className="focus-mark text-primary underline-offset-2 hover:underline"
              >
                {group.total} in {attentionDomainLabel(group.domain)}
              </Link>
            </Fragment>
          ))}
        </p>
      )}
    </section>
  );
}
