import { CaretDown, CaretRight } from '@phosphor-icons/react';
import { useId, useState, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { t, tn } from '../../i18n';
import type { DiscussContext } from '../../lib/discussWithMayor';
import type { MilestoneCount, NeedItem as Need, StallItem } from '../../lib/needsFromMe';
import { cn } from '../cn';
import { DiscussButton } from '../DiscussButton';
import { ExternalLink } from '../ExternalLink';

// One «Нужно от меня» row, 1:1 with the approved canvas (vk11 phone lane,
// Attention.dc.html aside rows on desktop, Phone-Needs.dc.html cards on a
// phone). A row is: the kind icon (warn hand, error triangle), the title on
// one line, one short meta line («держит 22 задачи, ждёт 3 дня»), and exactly
// one action. The Mayor's question carries «Ответить в Discord» (filled,
// brand-2, under the meta line as the canvas places it); an ask or a stall
// keeps the quiet «Обсудить в Discord». The phone card shows the Mayor's
// options and the two-line «why» instead, and opens as a whole (Phone-Card
// answers). The action stays outside the link so a button never nests in it.

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

/** The canvas row's short form: the largest unit only («3 дня», «20 ч», «12 мин»). */
export function waitedShort(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return t('{n} min', { n: minutes });
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return t('{n} h', { n: hours });
  return tn(Math.floor(hours / 24), { one: '{n} day', other: '{n} days' });
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

/** Graph sprint: «держит N задач» opens the graph of that chain. */
export function chainGraphHref(id: string): string {
  return `/beads?${new URLSearchParams({ view: 'graph', focus: id }).toString()}`;
}

/** An ask whose meta line leads with «держит N задач» (a link to its chain on the graph). */
function holdsLinked(need: Need): boolean {
  return need.kind !== 'stall' && need.holds > 0;
}

/** The row's one meta line (canvas: «держит 22 задачи, ждёт 3 дня», «стоит 20 ч · проверки красные»). */
export function metaText(need: Need): string {
  const waited = need.waitedMs === null ? null : waitedShort(need.waitedMs);
  if (need.kind === 'stall') {
    return [waited === null ? null : t('stuck for {time}', { time: waited }), need.summary]
      .filter((part): part is string => part !== null && part !== '')
      .join(' · ');
  }
  // An ask's meta is its reason (canvas «держит приёмку M04, Мэр ещё не спросил»).
  const head =
    need.holds > 0
      ? holdsText(need.holds)
      : need.kind === 'question'
        ? // owner 16.11: an asked question holding nothing stays and says so
          t('holds nothing')
        : need.summary;
  const wait = waited === null ? null : t('waits {time}', { time: waited });
  return [head, wait].filter((part): part is string => part !== null).join(', ');
}

function isStall(need: Need): need is StallItem {
  return need.kind === 'stall' && 'forOwner' in need;
}

/** A Mayor's question is answered in Discord; an unlinked one (no bridge id) only discussed. */
function isAnswerable(need: Need): boolean {
  return need.kind === 'question' && need.questionId !== undefined;
}

function HandIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5.5 8.5V4a1 1 0 0 1 2 0v3.5M7.5 7V2.8a1 1 0 0 1 2 0V7.5M9.5 7.5V4a1 1 0 0 1 2 0v5c0 2.7-1.8 4.6-4.2 4.6-1.6 0-2.7-.8-3.5-2.1L2.5 9.4a1 1 0 0 1 1.6-1.2L5.5 9.8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.5l6 10.5H2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 6.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.4" r="0.7" fill="currentColor" />
    </svg>
  );
}

const LINK = 'focus-mark flex min-w-0 max-w-full flex-col items-start gap-0 self-stretch';

/** Content rule (no raw ids): drop a leading slug id («m03-d3-fixed-dispatch — …»). */
export function rowTitle(title: string): string {
  const m = /^[a-z0-9][a-z0-9._]*-[a-z0-9._-]+\s+[—–-]\s+(.+)$/.exec(title);
  return m?.[1] ?? title;
}

/** The board card a row's link opens (`/beads?bead=<id>`), else null. */
export function boardBeadOf(href: string | null): string | null {
  if (href === null) return null;
  const [path, query = ''] = href.split('?', 2);
  if (path !== '/beads') return null;
  const params = new URLSearchParams(query);
  if ([...params.keys()].some((key) => key !== 'bead')) return null;
  return params.get('bead');
}

/**
 * The title block opens: its page, else an ask's chat thread, else nothing to
 * open. Owner 16.11: with `onOpenBead`, a board card opens in the page's
 * drawer instead (the href stays for a new tab).
 */
function RowLink({
  need,
  labelledBy,
  onOpenBead,
  children,
}: {
  need: Need;
  labelledBy: string;
  onOpenBead?: ((id: string) => void) | undefined;
  children: ReactNode;
}) {
  if (need.href !== null) {
    const bead = onOpenBead === undefined ? null : boardBeadOf(need.href);
    return (
      <Link
        to={need.href}
        aria-labelledby={labelledBy}
        className={LINK}
        {...(bead !== null && onOpenBead !== undefined
          ? {
              onClick: (e: MouseEvent<HTMLAnchorElement>) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                onOpenBead(bead);
              },
            }
          : {})}
      >
        {children}
      </Link>
    );
  }
  if (need.externalHref !== undefined) {
    return (
      <ExternalLink href={need.externalHref} aria-labelledby={labelledBy} className={LINK}>
        {children}
      </ExternalLink>
    );
  }
  return <div className={LINK}>{children}</div>;
}

/**
 * polish2 16.11 (owner): «Стоит» items held behind this question fold here;
 * «M04 10 · M03 4 · из них стоит 1 ▸» opens them. A button, so it sits outside the link.
 */
function HeldStalls({ need, stalls }: { need: Need; stalls: readonly StallItem[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const Caret = open ? CaretDown : CaretRight;
  return (
    <div className="border-t border-vk-border px-3 pb-1 md:px-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="focus-mark flex min-h-11 w-full flex-wrap items-center gap-x-2 text-left text-[13px] text-vk-text-low md:min-h-8"
      >
        {need.breakdown.length > 0 && (
          <span title={t('What waits for this')} className="font-vk-mono">
            {breakdownText(need.breakdown)}
          </span>
        )}
        <span>
          {tn(stalls.length, { one: '· {n} of them is stuck', other: '· {n} of them are stuck' })}
        </span>
        <Caret aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      </button>
      {open && (
        <ul id={listId} className="flex min-w-0 flex-col divide-y divide-vk-border">
          {stalls.map((stall) => (
            <li key={stall.id} className="min-w-0">
              {stall.href === null ? (
                <span className="block truncate py-2 text-[15px] text-vk-text-high">{stall.title}</span>
              ) : (
                <Link
                  to={stall.href}
                  className="focus-mark flex min-h-11 min-w-0 flex-col justify-center py-1 text-[15px] text-vk-text-high"
                >
                  <span className="truncate">{stall.title}</span>
                  {stall.summary !== null && (
                    <span className="truncate text-[13px] text-vk-text-low">{stall.summary}</span>
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

export function NeedItem({
  need,
  onOpenBead,
}: {
  need: Need;
  onOpenBead?: (id: string) => void;
}) {
  const titleId = useId();
  const held = need.heldStalls ?? [];
  const question = need.kind === 'question';
  const answerable = isAnswerable(need);
  const meta = metaText(need);
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
      className="flex min-w-0 flex-col rounded-[4.5px] border border-vk-border bg-vk-bg-primary text-vk-text-normal md:rounded-[3px]"
    >
      <div
        className={cn(
          'flex min-w-0 gap-2.5 md:min-h-11 md:gap-2 md:p-2',
          question ? 'p-3' : 'min-h-14 px-3 py-2.5',
        )}
      >
        <span
          className={cn(
            'flex shrink-0 pt-[3px]',
            need.kind === 'stall' ? 'text-vk-error' : 'text-warn',
          )}
        >
          {need.kind === 'stall' ? <WarnIcon /> : <HandIcon />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col items-start">
          <RowLink need={need} labelledBy={titleId} onOpenBead={onOpenBead}>
            {/* Phone-Needs: the Mayor's options first, read-only (the card answers). */}
            {need.choices.length > 0 && (
              <ul
                aria-label={t('Options from the Mayor')}
                className="mb-2 flex flex-wrap gap-1.5 md:hidden"
              >
                {need.choices.map((choice) => (
                  <li
                    key={choice}
                    className="inline-flex h-[26px] items-center rounded-[3px] border border-vk-border px-2 text-[13px] text-vk-text-normal"
                  >
                    {choice}
                  </li>
                ))}
              </ul>
            )}
            <span
              id={titleId}
              className={cn(
                'max-w-full text-vk-text-high',
                question
                  ? 'text-[17px] font-medium leading-[1.4] [overflow-wrap:anywhere] md:truncate md:text-[15px] md:font-normal md:leading-6'
                  : 'truncate text-[15px] leading-6',
              )}
            >
              {rowTitle(need.title)}
            </span>
            {meta !== '' && !holdsLinked(need) && (
              <span data-testid="need-meta" className="max-w-full truncate text-[13px] leading-5 text-vk-text-low">
                {meta}
              </span>
            )}
            {question && need.summary !== null && (
              <span className="mt-1 line-clamp-2 text-sm leading-[1.45] text-vk-text-normal [overflow-wrap:anywhere] md:hidden">
                {need.summary}
              </span>
            )}
          </RowLink>
          {holdsLinked(need) && (
            <span data-testid="need-meta" className="max-w-full truncate text-[13px] leading-5 text-vk-text-low">
              <Link
                to={chainGraphHref(need.id)}
                title={t('holds {n} tasks: show the chain on the graph')}
                className="underline decoration-dotted underline-offset-2 hover:text-vk-text-high focus-mark"
              >
                {holdsText(need.holds)}
              </Link>
              {meta.slice(holdsText(need.holds).length)}
            </span>
          )}
          {need.breakdown.length > 0 && held.length === 0 && (
            <span
              title={t('What waits for this')}
              className="hidden font-vk-mono text-[13px] text-vk-text-low md:block"
            >
              {breakdownText(need.breakdown)}
            </span>
          )}
          {answerable ? (
            <DiscussButton
              ctx={ctx}
              label={t('Answer in Discord')}
              className="mt-1.5 hidden h-7 gap-0 rounded-[3px] bg-vk-brand-secondary px-2 text-[13px] font-medium text-white hover:bg-vk-brand-secondary hover:text-white md:inline-flex md:h-7 [&>svg]:hidden"
            />
          ) : (
            <DiscussButton
              ctx={ctx}
              className="-ml-2.5 mt-0.5 h-9 px-2.5 text-[13px] enabled:text-vk-brand-secondary md:h-7"
            />
          )}
        </div>
      </div>
      {held.length > 0 && <HeldStalls need={need} stalls={held} />}
    </li>
  );
}
