import { CaretRightIcon, XIcon } from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import { t } from '../../i18n';
import { openExternal } from '../../lib/openExternal';
import type { OwnerQuestion } from '../../lib/ownerQuestions';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { cn } from '../cn';
import { mayorChannelUrl } from '../../lib/mayorLink';
import type { DiscussContext } from '../../lib/discussWithMayor';
import { DiscussButton } from '../DiscussButton';
import { assigneeInitial, statusDot } from './drawerFacts';

// The VK task panel (vk lane 2): a right-side drawer from `md` up, a
// full-screen card below it. Design frames: Main (right panel),
// Card-Question, Phone-Card, Phone-Card-Answered (owner change 15.11:
// compact question block, «Обсудить с Мэром» under the title on every task,
// the answered question folds into one «История» row).

// Owner 16.11 (no Discord Activity): the option buttons never answer in
// place; they open the Mayor's Discord message, where the owner answers.

export const SUMMARY_LIMIT = 280;

const STATUS_LABEL: Readonly<Record<string, string>> = {
  open: 'status.open',
  in_progress: 'status.in_progress',
  blocked: 'status.blocked',
  closed: 'status.closed',
  deferred: 'status.deferred',
};

export function statusLabel(status: string): string {
  const key = STATUS_LABEL[status];
  return key === undefined ? status : t(key);
}

/** «Ждёт · ждёт: M03, gc-2» or «Ждёт · ничего не ждёт», at most 280 characters. */
export function taskSummary(bead: SupervisorBead, tags: readonly string[]): string {
  const waits =
    tags.length > 0 ? t('Waiting on: {tags}', { tags: tags.join(', ') }) : t('Waiting on nothing');
  const full = `${statusLabel(bead.status)} · ${waits}`;
  return full.length <= SUMMARY_LIMIT ? full : `${full.slice(0, SUMMARY_LIMIT - 1)}…`;
}

export interface TaskDrawerProps {
  open: boolean;
  onClose: () => void;
  /**
   * Header crumb (canvas «M04 #3 / PR #580»): with it the header is the
   * canvas one (crumb, copy-link, «···», close) and `chips` move to their own
   * row under the status row. Without it (peer card) `chips` sit in the header.
   */
  crumb?: ReactNode;
  /** The link the copy button copies; defaults to the page URL. */
  copyHref?: string;
  /** Canvas status row: dot + status, assignee chip, kind. */
  statusRow?: ReactNode;
  /** Chip row (header without `crumb`; own row under the status row with it). */
  chips?: ReactNode;
  /** Top block (the open question), above the title. */
  top?: ReactNode;
  title: ReactNode;
  /** One compact line right under the title (polish2 item 8: status, stage, executor, date, labels). */
  meta?: ReactNode;
  /** Action row: under the title from `md`, a sticky bottom bar below it. */
  actions?: ReactNode;
  /** The description, right under the actions (canvas: no «Подробности»). */
  description?: ReactNode;
  children?: ReactNode;
  /**
   * Phone: stop above the bottom tab bar (56 px + safe area) so a pinned
   * composer sits directly on it (vk-final, design Phone-Peer-Card).
   */
  aboveTabs?: boolean;
  /**
   * Pinned to the drawer's bottom edge, outside the scrolling body (vk-final:
   * the card's comment box, vibe-kanban style). The body scrolls above it.
   */
  footer?: ReactNode;
}

const ICON_BTN =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-vk-text-low hover:bg-vk-bg-secondary hover:text-vk-text-high focus-mark md:h-7 md:w-7';

function LinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.6 9.4l2.8-2.8M7.2 4.6l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7l-1.2 1.2M8.8 11.4l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7l1.2-1.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function copyLink(href: string | undefined): void {
  const text = href ?? (typeof window === 'undefined' ? '' : window.location.href);
  if (text.length === 0) return;
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

export function TaskDrawer({
  open,
  onClose,
  crumb,
  copyHref,
  statusRow,
  chips,
  top,
  title,
  meta,
  actions,
  description,
  children,
  aboveTabs = false,
  footer = null,
}: TaskDrawerProps) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const canvas = crumb !== undefined;

  return (
    <div
      className={cn('fixed inset-0 z-50 bg-scrim/50', aboveTabs && 'bottom-[calc(3.5rem+var(--saib))] md:bottom-0')}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('Open task')}
        className={cn(
          'fixed inset-0 flex flex-col bg-vk-bg-primary font-vk-sans text-vk-text-normal shadow-overlay md:inset-y-0 md:left-auto md:right-0 md:w-[580px] md:max-w-full md:border-l md:border-vk-border',
          aboveTabs && 'bottom-[calc(3.5rem+var(--saib))] md:bottom-0',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          data-testid="task-drawer-header"
          className="flex min-h-[44px] items-center justify-between gap-2 border-b border-vk-border px-2 py-1"
        >
          {/* vk-final part 5: the phone's full-screen card returns to the board. */}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 shrink-0 items-center rounded-sm px-2 text-[15px] text-vk-text-normal focus-mark md:hidden"
          >
            {t('← Board')}
          </button>
          {canvas ? (
            <div
              data-testid="task-crumb"
              className="flex min-w-0 flex-1 items-center gap-1 font-vk-mono text-[15px] text-vk-text-high"
            >
              {crumb}
              <button
                type="button"
                aria-label={t('Copy link')}
                onClick={() => copyLink(copyHref)}
                className={ICON_BTN}
              >
                <LinkIcon />
              </button>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{chips}</div>
          )}
          <div className="flex shrink-0 gap-1">
            {canvas && (
              <button type="button" aria-label={t('More')} className={ICON_BTN}>
                <DotsIcon />
              </button>
            )}
            <button type="button" onClick={onClose} aria-label={t('Close')} className={ICON_BTN}>
              {canvas ? <CloseIcon /> : <XIcon size={18} weight="bold" aria-hidden="true" />}
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {statusRow !== undefined && (
            <div
              data-testid="task-status-row"
              className="flex flex-wrap items-center gap-1 border-b border-vk-border p-2"
            >
              {statusRow}
            </div>
          )}
          {canvas && chips !== undefined && chips !== null && (
            <div
              data-testid="task-chips"
              className="flex flex-wrap items-center gap-1 border-b border-vk-border p-2"
            >
              {chips}
            </div>
          )}
          <div className="flex flex-col gap-2 px-2 pb-4 pt-2 md:pb-4">
            {top}
            <h2 className="mt-2 text-xl font-medium text-vk-text-high [overflow-wrap:anywhere]">{title}</h2>
            {meta}
            {actions && (
              <div
                data-testid="task-drawer-actions"
                className="flex flex-wrap gap-2"
              >
                {actions}
              </div>
            )}
            {description}
          </div>
          <div className="flex flex-col pb-4 [&>*]:border-t [&>*]:border-vk-border [&>*]:p-2">{children}</div>
        </div>
        {footer !== null && (
          <div
            data-testid="task-drawer-footer"
            className="flex-none border-t border-vk-border bg-vk-bg-secondary p-2"
            // above the tab bar the safe area is already the tab bar's
            style={{
              paddingBottom: aboveTabs ? '0.5rem' : 'calc(0.5rem + var(--saib, env(safe-area-inset-bottom)))',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Chip({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'brand' }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded-sm px-2 text-sm',
        tone === 'brand' ? 'bg-vk-brand/15 text-vk-text-high' : 'bg-vk-bg-panel text-vk-text-normal',
      )}
    >
      {children}
    </span>
  );
}

// ---- Canvas rows (vk-1to1) ---------------------------------------------

/** Canvas status row: «● В работе», «И Исполнитель», «Подзадача M04». */
export function StatusRow({
  status,
  assignee,
  kind,
  tag,
}: {
  status: string;
  assignee: string | null;
  kind: string;
  tag: string | null;
}) {
  return (
    <>
      <span className="inline-flex items-center gap-1.5 rounded-sm bg-vk-bg-panel px-2 py-1 text-sm">
        <span
          aria-hidden="true"
          data-testid="status-dot"
          className="h-2 w-2 rounded-full"
          style={{ background: statusDot(status) }}
        />
        {statusLabel(status)}
      </span>
      {assignee !== null && assignee.length > 0 && (
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-sm bg-vk-bg-panel px-2 py-1 text-sm">
          <span
            aria-hidden="true"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1D5BD6] text-[11px] font-semibold text-white"
          >
            {assigneeInitial(assignee)}
          </span>
          <span className="truncate">{assignee}</span>
        </span>
      )}
      <span className="whitespace-nowrap text-sm">
        <span className="text-vk-text-low">{kind}</span>
        {tag !== null && <span className="font-vk-mono"> {tag}</span>}
      </span>
    </>
  );
}

/** Canvas chip: 20 px, bg-panel, a colour dot and a medium low-contrast label. */
export function DotChip({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-sm bg-vk-bg-panel px-2 text-sm font-medium text-vk-text-low">
      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

/** Canvas bottom box: «Сообщение Мэру про эту задачу» + «Обсудить в Discord». */
export function MayorMessageBox({ ctx }: { ctx: DiscussContext }) {
  const [text, setText] = useState('');
  return (
    <div data-testid="mayor-message" className="flex flex-col gap-2">
      <label htmlFor="to-mayor" className="text-sm text-vk-text-low">
        {t('Message to the Mayor about this task')}
      </label>
      <textarea
        id="to-mayor"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('For example: «why is it stuck?» or «put it off till tomorrow»')}
        className="box-border w-full resize-none rounded-sm border border-vk-border bg-vk-bg-primary p-2 text-[15px] text-vk-text-normal focus-mark"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-vk-text-low">{t('Goes to the Mayor in Discord')}</span>
        <DiscussButton ctx={ctx} variant="primary" message={text} onSent={() => setText('')} />
      </div>
    </div>
  );
}

// ---- The question -------------------------------------------------------

export interface Answer {
  choice: number;
}

function ChoiceButton({
  label,
  then,
  primary,
  chosen,
  disabled,
  onClick,
}: {
  label: string;
  then: string;
  primary: boolean;
  chosen?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-h-[52px] w-full flex-col items-start gap-0.5 rounded-sm px-3 py-2 text-left text-base font-medium [overflow-wrap:anywhere] focus-mark disabled:cursor-default',
        primary
          ? 'bg-vk-brand-secondary text-vk-on-brand hover:bg-vk-brand-secondary/90' // review I-1 + vk11: canvas brand-2 #AC5111 (white on brand #EA7A29 is under 4.5:1)
          : 'border border-vk-border bg-vk-bg-primary text-vk-text-high hover:bg-vk-bg-secondary',
        disabled && !chosen && 'opacity-60',
      )}
    >
      <span>
        {label}
        {chosen && <span className="ml-2 text-sm font-normal">{t('chosen')}</span>}
      </span>
      {then.length > 0 && (
        <span className={cn('text-sm font-normal', primary ? 'text-vk-on-brand/90' : 'text-vk-text-low')}>
          {then}
        </span>
      )}
    </button>
  );
}

export interface QuestionCardProps {
  q: OwnerQuestion;
  onAnswered: (a: Answer) => void;
}

/** The open question, compact: title, «Что случилось», the options, one button. */
export function QuestionCard({ q }: QuestionCardProps) {
  // Owner 16.11: the owner answers in Discord, on the Mayor's own message
  // (its buttons prove it is the owner). polish2 16.11: ONE primary
  // «Ответить в Discord» (the old «Answer» + «Other — discuss» pair did the
  // same thing); the options are read-only so he knows what he will pick.
  // With no message link it opens the #мэр chat.
  const target = q.chatUrl.length > 0 ? q.chatUrl : mayorChannelUrl();

  return (
    <section
      data-testid="question-card"
      className="flex flex-col gap-3 rounded-sm border border-vk-border bg-vk-bg-secondary p-3"
    >
      <p className="text-lg font-semibold text-vk-text-high [overflow-wrap:anywhere]">{q.question}</p>
      {q.why !== null && (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-vk-text-high">{t('What happened')}</span>
          <p className="text-[15px] text-vk-text-normal [overflow-wrap:anywhere]">{q.why}</p>
        </div>
      )}
      {q.choices.length > 0 && (
        <ul data-testid="question-choices" className="flex flex-col gap-1.5">
          {q.choices.map((c, i) => (
            <li
              key={`${i}:${c.label}`}
              className="flex flex-col gap-0.5 rounded-sm border border-vk-border bg-vk-bg-primary px-3 py-2"
            >
              <span className="text-base font-medium text-vk-text-high [overflow-wrap:anywhere]">{c.label}</span>
              {c.then.length > 0 && (
                <span className="text-sm text-vk-text-low [overflow-wrap:anywhere]">{c.then}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <ChoiceButton
        label={t('Answer in Discord')}
        then=""
        primary
        disabled={target === null}
        onClick={() => {
          if (target !== null) openExternal(target);
        }}
      />
    </section>
  );
}

/** «История»: one collapsed row for the answered question; a tap expands it. */
export function QuestionHistory({ q, answer }: { q: OwnerQuestion; answer: Answer }) {
  const [open, setOpen] = useState(false);
  const chosen = q.choices[answer.choice]?.label ?? '';
  return (
    <section data-testid="task-history" className="flex flex-col gap-1">
      <h3 className="py-1 text-sm font-medium text-vk-text-high">{t('History')}</h3>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-sm px-2 text-left text-sm text-vk-text-normal hover:bg-vk-bg-secondary focus-mark"
      >
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {t('Mayor question · answered: {choice} · just now', { choice: chosen })}
        </span>
        <CaretRightIcon
          size={14}
          weight="bold"
          aria-hidden="true"
          className={cn('shrink-0 transition-transform', open && 'rotate-90')}
        />
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-2 pb-2">
          <p className="text-[15px] font-medium text-vk-text-high [overflow-wrap:anywhere]">{q.question}</p>
          {q.choices.map((c, i) => (
            <ChoiceButton
              key={`${i}:${c.label}`}
              label={c.label}
              then={c.then}
              primary={false}
              chosen={i === answer.choice}
              disabled
            />
          ))}
        </div>
      )}
    </section>
  );
}
