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
}

export function DiscussButton({ ctx, className, label }: DiscussButtonProps) {
  const channel = mayorChannelUrl();
  const [note, setNote] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className={cn(
          'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-sm font-medium text-vk-text-normal transition-colors hover:bg-vk-bg-panel hover:text-vk-text-high disabled:cursor-not-allowed disabled:opacity-60 focus-mark md:h-8',
          className,
        )}
        disabled={channel === null}
        {...(channel === null ? { title: t('Mayor channel is not configured') } : {})}
        onClick={() => {
          if (channel === null) return;
          openExternal(channel);
          setNote(null);
          void postDiscuss(ctx).catch((err: unknown) => {
            setNote(
              err instanceof CommentWriteError && err.code === 'disabled'
                ? t('Writes are disabled here')
                : t('Could not notify the Mayor'),
            );
          });
        }}
      >
        <ChatCircleDotsIcon aria-hidden="true" size={16} className="shrink-0" />
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
