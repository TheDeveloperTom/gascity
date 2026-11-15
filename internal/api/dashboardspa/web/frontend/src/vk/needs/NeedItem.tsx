import { useId, type ReactNode } from 'react';
import { Link } from 'react-router';
import { t, tn } from '../../i18n';
import type { DiscussContext } from '../../lib/discussWithMayor';
import type { MilestoneCount, NeedItem as Need, StallItem } from '../../lib/needsFromMe';
import { DiscussButton } from '../DiscussButton';
import { canWrite } from '../../embed/activitySession';
import { ExternalLink } from '../ExternalLink';

// One «Нужно от меня» card (vk lane 3, Attention / Phone-Needs frames). The
// card opens as a whole (the decision happens inside it, lane 2); the
// Mayor's options show read-only. «Обсудить в Discord» sits outside the link
// so a button never nests inside an anchor.

const SUMMARY_MAX = 280;

/** «3 дня 8 ч», «20 ч», «12 мин». */
export function waitedText(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return t('{n} min', { n: minutes });
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return t('{n} h', { n: hours });
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  const dayText = tn(days, { one: '{n} day', other: '{n} days' });
  return rest === 0 ? dayText : `${dayText} ${t('{n} h', { n: rest })}`;
}

export function holdsText(n: number): string {
  return tn(n, { one: 'holds {n} task', other: 'holds {n} tasks' });
}

export function breakdownText(breakdown: readonly MilestoneCount[]): string {
  return breakdown.map((b) => `${b.milestone} ${b.count}`).join(' · ');
}

/** What the owner is asked for, for the Mayor: ≤ 280 characters. */
export function discussSummary(need: Need): string {
  const parts = [need.title];
  if (need.kind === 'stall' && need.summary !== null) parts.push(need.summary);
  if (need.holds > 0) parts.push(holdsText(need.holds));
  const text = parts.join(' · ');
  return text.length <= SUMMARY_MAX ? text : `${text.slice(0, SUMMARY_MAX - 1)}…`;
}

// Design pass 15.11 (vibe-kanban density): the card is one row — the text
// opens the task, the quiet «Обсудить» sits at the right edge.
const CARD = 'focus-mark flex min-h-11 min-w-0 flex-1 items-start gap-3 rounded-md px-3 py-2.5';

function isStall(need: Need): need is StallItem {
  return need.kind === 'stall' && 'forOwner' in need;
}

/** The whole card opens: its page, else an ask's chat thread, else nothing to open. */
function CardLink({
  need,
  labelledBy,
  children,
}: {
  need: Need;
  labelledBy: string;
  children: ReactNode;
}) {
  if (need.href !== null) {
    return (
      <Link to={need.href} aria-labelledby={labelledBy} className={CARD}>
        {children}
      </Link>
    );
  }
  // Task 6: an Activity reader (Richard) gets no chat (answer) link.
  if (need.externalHref !== undefined && canWrite()) {
    return (
      <ExternalLink href={need.externalHref} aria-labelledby={labelledBy} className={CARD}>
        {children}
      </ExternalLink>
    );
  }
  return <div className={CARD}>{children}</div>;
}

export function NeedItem({ need }: { need: Need }) {
  const titleId = useId();
  const waited =
    need.waitedMs === null
      ? null
      : need.kind !== 'stall'
        ? t('waits for you {time}', { time: waitedText(need.waitedMs) })
        : t('stuck for {time}', { time: waitedText(need.waitedMs) });
  const meta = [need.kind === 'question' ? t('The Mayor asks') : null, waited]
    .filter((part): part is string => part !== null)
    .join(' · ');
  const ctx: DiscussContext = {
    kind: 'need',
    beadId: need.id,
    title: need.title,
    summary: discussSummary(need),
  };
  return (
    <li
      data-need={need.id}
      data-kind={need.kind}
      {...(isStall(need) ? { 'data-for-owner': String(need.forOwner) } : {})}
      className="group flex min-w-0 flex-col rounded-md border border-vk-border bg-vk-bg-primary text-vk-text-normal transition-colors hover:border-vk-text-low/40 hover:bg-vk-bg-panel sm:flex-row sm:items-center"
    >
      <CardLink need={need} labelledBy={titleId}>
        <div className="min-w-0 flex-1">
          {meta.length > 0 && <p className="text-[13px] leading-5 text-vk-text-low">{meta}</p>}
          <p
            id={titleId}
            className="text-[15px] font-medium leading-6 text-vk-text-high [overflow-wrap:anywhere]"
          >
            {need.title}
          </p>
          {need.summary !== null && (
            <p className="mt-0.5 line-clamp-2 text-sm leading-5 text-vk-text-normal [overflow-wrap:anywhere]">
              {need.summary}
            </p>
          )}
          {need.holds > 0 && (
            <p className="mt-2 flex flex-wrap gap-x-2 text-label text-vk-text-low">
              <span className="font-medium text-vk-text-normal">{holdsText(need.holds)}</span>
              {need.breakdown.length > 0 && (
                <span title={t('What waits for this')} className="font-vk-mono">
                  {breakdownText(need.breakdown)}
                </span>
              )}
            </p>
          )}
          {need.choices.length > 0 && (
            <ul aria-label={t('Options from the Mayor')} className="mt-2 flex flex-wrap gap-1.5">
              {need.choices.map((choice) => (
                <li
                  key={choice}
                  className="rounded border border-vk-border px-2 py-0.5 text-label text-vk-text-normal [overflow-wrap:anywhere]"
                >
                  {choice}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardLink>
      {canWrite() && (
        <div className="-mt-2 flex shrink-0 justify-end px-1 pb-0.5 sm:mt-0 sm:pb-0 sm:pr-2">
          {/* quiet until the row is hovered or focused: the row is the action */}
          <DiscussButton
            ctx={ctx}
            className="sm:opacity-70 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
          />
        </div>
      )}
    </li>
  );
}
