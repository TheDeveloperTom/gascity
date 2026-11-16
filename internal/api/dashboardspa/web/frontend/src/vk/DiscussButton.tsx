import { ChatCircleDotsIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { t } from '../i18n';
import type { DiscussContext } from '../lib/discussWithMayor';
import { mayorChannelUrl } from '../lib/mayorLink';
import { openExternal } from '../lib/openExternal';
import { postDiscuss } from '../supervisor/discussWrites';
import { CommentWriteError } from '../supervisor/peerCommentWrites';
import { cn } from './cn';

// «Обсудить в Discord» / «Обсудить с Мэром» (owner 16.11): opens the owner's
// Mayor channel (#мэр) SYNCHRONOUSLY inside the click (Safari/iOS popup
// rules), then (B10) tells the Mayor through our peer-boards service
// (POST /v1/discuss → `gc devwork owner discuss`, dedup per id). A failed post
// shows a small inline note; it never blocks the link. The channel comes at runtime from the city
// (lib/mayorLink); with none known the button is disabled and says why.
// Design pass 15.11: a quiet secondary action (ghost, icon + label).

export interface DiscussButtonProps {
  /** What is being discussed (sent to the Mayor; the channel is the same). */
  ctx: DiscussContext;
  className?: string;
  /** Visible label; defaults to «Обсудить в Discord». */
  label?: string;
  /**
   * Canvas look (vk-1to1): `quiet` (default) ghost; `secondary` the canvas
   * «Обсудить с Мэром» (bordered, bg-secondary, speech icon); `primary` the
   * canvas «Обсудить в Discord» (filled brand-2, no icon).
   */
  variant?: 'quiet' | 'secondary' | 'primary';
  /** Owner's own words for the Mayor, prepended to the summary when non-empty. */
  message?: string;
  /** Called after the link opened (e.g. to clear the message box). */
  onSent?: () => void;
}

function SpeechIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M2.5 4h11v6.5H7.2L4 13v-2.5H2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

const VARIANT = {
  quiet:
    'gap-1.5 px-2.5 text-sm font-medium text-vk-text-normal hover:bg-vk-bg-panel hover:text-vk-text-high',
  secondary:
    'gap-1.5 border border-vk-border bg-vk-bg-secondary px-2.5 text-[15px] text-vk-text-high hover:bg-vk-bg-panel',
  primary: 'border-0 bg-[#AC5111] px-2.5 text-base font-medium text-white hover:bg-[#963F0A]',
} as const;

export function DiscussButton({ ctx, className, label, variant = 'quiet', message = '', onSent }: DiscussButtonProps) {
  const channel = mayorChannelUrl();
  const [note, setNote] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className={cn(
          'inline-flex h-11 shrink-0 items-center rounded-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-mark md:h-8',
          VARIANT[variant],
          className,
        )}
        disabled={channel === null}
        {...(channel === null ? { title: t('Mayor channel is not configured') } : {})}
        onClick={() => {
          if (channel === null) return;
          openExternal(channel);
          setNote(null);
          onSent?.();
          const words = message.trim();
          void postDiscuss(words.length > 0 ? { ...ctx, summary: `${words} · ${ctx.summary}` } : ctx).catch((err: unknown) => {
            setNote(
              err instanceof CommentWriteError && err.code === 'disabled'
                ? t('Writes are disabled here')
                : t('Could not notify the Mayor'),
            );
          });
        }}
      >
        {variant === 'quiet' && <ChatCircleDotsIcon aria-hidden="true" size={16} className="shrink-0" />}
        {variant === 'secondary' && <SpeechIcon />}
        {label ?? t('Discuss in Discord')}
      </button>
      {note !== null && (
        <span role="status" className="self-center text-xs text-vk-text-low">
          {note}
        </span>
      )}
    </>
  );
}
