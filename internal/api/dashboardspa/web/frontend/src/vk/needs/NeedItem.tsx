import { CaretDown, CaretRight } from '@phosphor-icons/react';
import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { t, tn } from '../../i18n';
import type { DiscussContext } from '../../lib/discussWithMayor';
import type { MilestoneCount, NeedItem as Need, StallItem } from '../../lib/needsFromMe';
import { DiscussButton } from '../DiscussButton';
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
  if (need.externalHref !== undefined) {
    return (
      <ExternalLink href={need.externalHref} aria-labelledby={labelledBy} className={CARD}>
        {children}
      </ExternalLink>
    );
  }
  return <div className={CARD}>{children}</div>;
}

function HoldsLine({ need }: { need: Need }) {
  return (
    <>
      <span className="font-medium text-vk-text-normal">{holdsText(need.holds)}</span>
      {need.breakdown.length > 0 && (
        <span title={t('What waits for this')} className="font-vk-mono">
          {breakdownText(need.breakdown)}
        </span>
      )}
    </>
  );
}

/**
 * polish2 16.11 (owner): «Стоит» items held behind this question fold here;
 * «держит 22 задачи ▸» opens them. A button, so it sits outside the card link.
 */
function HeldStalls({ need, stalls }: { need: Need; stalls: readonly StallItem[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const Caret = open ? CaretDown : CaretRight;
  return (
    <div className="border-t border-vk-border px-3 pb-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="focus-mark flex min-h-11 w-full flex-wrap items-center gap-x-2 text-left text-label text-vk-text-low xl:text-sm"
      >
        <HoldsLine need={need} />
        <span>{tn(stalls.length, { one: '· {n} of them is stuck', other: '· {n} of them are stuck' })}</span>
        <Caret aria-hidden="true" className="h-4 w-4 shrink-0" />
      </button>
      {open && (
        <ul id={listId} className="flex min-w-0 flex-col divide-y divide-vk-border">
          {stalls.map((stall) => (
            <li key={stall.id} className="min-w-0">
              {stall.href === null ? (
                <span className="block py-2 text-sm text-vk-text-normal [overflow-wrap:anywhere]">{stall.title}</span>
              ) : (
                <Link
                  to={stall.href}
                  className="focus-mark flex min-h-11 min-w-0 flex-col justify-center py-1.5 text-sm text-vk-text-normal hover:text-vk-text-high"
                >
                  <span className="[overflow-wrap:anywhere]">{stall.title}</span>
                  {stall.summary !== null && (
                    <span className="text-[13px] text-vk-text-low [overflow-wrap:anywhere]">{stall.summary}</span>
                  )}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NeedItem({ need }: { need: Need }) {
  const titleId = useId();
  const held = need.heldStalls ?? [];
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
      className="group flex min-w-0 flex-col rounded-md border border-vk-border bg-vk-bg-primary text-vk-text-normal transition-colors hover:border-vk-text-low/40"
    >
      <div className="flex min-w-0 flex-col hover:bg-vk-bg-panel sm:flex-row sm:items-center">
      <CardLink need={need} labelledBy={titleId}>
        <div className="min-w-0 flex-1">
          {meta.length > 0 && <p className="text-[13px] leading-5 text-vk-text-low xl:text-sm">{meta}</p>}
          <p
            id={titleId}
            className="text-[15px] font-medium leading-6 text-vk-text-high [overflow-wrap:anywhere] xl:text-[17px] xl:leading-7"
          >
            {need.title}
          </p>
          {need.summary !== null && (
            <p className="mt-0.5 line-clamp-2 text-sm leading-5 text-vk-text-normal [overflow-wrap:anywhere] xl:text-[15px] xl:leading-6">
              {need.summary}
            </p>
          )}
          {need.holds > 0 && held.length === 0 && (
            <p className="mt-2 flex flex-wrap gap-x-2 text-label text-vk-text-low xl:text-sm">
              <HoldsLine need={need} />
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
      <div className="-mt-2 flex shrink-0 justify-end px-1 pb-0.5 sm:mt-0 sm:pb-0 sm:pr-2">
        {/* quiet until the row is hovered or focused: the row is the action */}
        <DiscussButton
          ctx={ctx}
          className="enabled:text-vk-brand-secondary"
        />
      </div>
      </div>
      {held.length > 0 && <HeldStalls need={need} stalls={held} />}
    </li>
  );
}
