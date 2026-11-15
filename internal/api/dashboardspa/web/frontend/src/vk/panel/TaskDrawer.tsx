import { CaretRightIcon, XIcon } from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import { t } from '../../i18n';
import { isEmbedded } from '../../lib/apiBase';
import { openExternal } from '../../lib/openExternal';
import type { OwnerQuestion } from '../../lib/ownerQuestions';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { canWrite } from '../../embed/activitySession';
import { cn } from '../cn';
import {
  answerErrorText,
  answerQuestion as recordAnswer,
  type DiscussContext,
} from '../../lib/discussWithMayor';
import { DiscussButton } from '../DiscussButton';

// The VK task panel (vk lane 2): a right-side drawer from `md` up, a
// full-screen card below it. Design frames: Main (right panel),
// Card-Question, Phone-Card, Phone-Card-Answered (owner change 15.11:
// compact question block, «Обсудить с Мэром» under the title on every task,
// the answered question folds into one «История» row).

// Embed mode (Discord Activity) is lane 6's `isEmbedded()` (lib/apiBase).
// Controller ruling 15.11: the option buttons answer in place ONLY inside the
// Activity, where the gateway proves the owner's Discord identity (act6's
// wired `answerQuestion(qid, choice)`); in the browser they open the Mayor's
// Discord message, because on localhost any process could post as the owner.

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
  /** Chip row above the title (status, milestone, «нужен ты»). */
  chips?: ReactNode;
  /** Top block (the open question), above the title. */
  top?: ReactNode;
  title: ReactNode;
  /** Action row: under the title from `md`, a sticky bottom bar below it. */
  actions?: ReactNode;
  children?: ReactNode;
}

export function TaskDrawer({ open, onClose, chips, top, title, actions, children }: TaskDrawerProps) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-scrim/50" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 flex flex-col bg-vk-bg-primary font-vk-sans text-vk-text-normal shadow-overlay md:inset-y-0 md:left-auto md:right-0 md:w-[560px] md:max-w-full md:border-l md:border-vk-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-h-[52px] items-center justify-between gap-2 border-b border-vk-border px-4">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">{chips}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Close')}
            className="-mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-vk-text-low hover:bg-vk-bg-secondary hover:text-vk-text-high focus-mark"
          >
            <XIcon size={18} weight="bold" aria-hidden="true" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-4 md:pb-6">
          {top}
          <h2 className="text-xl font-semibold text-vk-text-high [overflow-wrap:anywhere]">
            {title}
          </h2>
          {actions && (
            <div
              data-testid="task-drawer-actions"
              className="sticky bottom-0 order-last -mx-4 mt-auto flex flex-wrap gap-2 border-t border-vk-border bg-vk-bg-primary px-4 pt-2 md:static md:order-none md:mx-0 md:mt-0 md:border-0 md:p-0"
              style={{ paddingBottom: 'calc(0.5rem + var(--saib, env(safe-area-inset-bottom)))' }}
            >
              {actions}
            </div>
          )}
          {children}
        </div>
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
          ? 'bg-vk-brand-secondary text-vk-on-brand hover:bg-vk-brand-secondary/90'
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
  discussCtx: DiscussContext;
  onAnswered: (a: Answer) => void;
}

/** The open question, compact: title, «Что случилось», options, «Другое». */
export function QuestionCard({ q, discussCtx, onAnswered }: QuestionCardProps) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const embedded = isEmbedded();
  // Task 6: an Activity reader (Richard) sees the question, not the choices.
  const writable = canWrite();
  const pick = (choice: number) => {
    // Ruling 15.11: in place only inside the Activity; the browser opens the message.
    if (!embedded) {
      openExternal(q.chatUrl);
      return;
    }
    if (!writable || sending) return;
    setSending(true);
    setError(null);
    recordAnswer(q.questionId, choice).then(
      () => onAnswered({ choice }),
      (err: unknown) => {
        setError(answerErrorText(err));
        setSending(false);
      },
    );
  };

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
      {writable && (
        <div data-testid="question-choices" className="flex flex-col gap-2">
          {q.choices.length === 0 ? (
            <ChoiceButton label={t('Answer in Discord')} then="" primary onClick={() => openExternal(q.chatUrl)} />
          ) : (
            q.choices.map((c, i) => (
              <ChoiceButton
                key={`${i}:${c.label}`}
                label={c.label}
                then={c.then}
                primary={i === 0}
                disabled={sending}
                onClick={() => pick(i)}
              />
            ))
          )}
        </div>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-vk-error">
          {error}
        </p>
      )}
      <DiscussButton ctx={discussCtx} label={t('Other — discuss in Discord')} />
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
