import { ChatCircleDotsIcon } from '@phosphor-icons/react';
import { t } from '../i18n';
import type { DiscussContext } from '../lib/discussWithMayor';
import { mayorChannelUrl } from '../lib/mayorLink';
import { openExternal } from '../lib/openExternal';
import { cn } from './cn';

// «Обсудить в Discord» / «Обсудить с Мэром» (owner 16.11): opens the owner's
// Mayor channel (#мэр) SYNCHRONOUSLY inside the click (Safari/iOS popup
// rules) and posts nothing. The channel comes at runtime from the city
// (lib/mayorLink); with none known the button is disabled and says why.
// Design pass 15.11: a quiet secondary action (ghost, icon + label).

export interface DiscussButtonProps {
  /** What is being discussed (kept for callers; the channel is the same). */
  ctx: DiscussContext;
  className?: string;
  /** Visible label; defaults to «Обсудить в Discord». */
  label?: string;
}

export function DiscussButton({ className, label }: DiscussButtonProps) {
  const channel = mayorChannelUrl();
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-sm font-medium text-vk-text-low transition-colors hover:bg-vk-bg-panel hover:text-vk-text-high disabled:cursor-not-allowed disabled:opacity-60 focus-mark md:h-8',
        className,
      )}
      disabled={channel === null}
      {...(channel === null ? { title: t('Mayor channel is not configured') } : {})}
      onClick={() => {
        if (channel !== null) openExternal(channel);
      }}
    >
      <ChatCircleDotsIcon aria-hidden="true" size={16} className="shrink-0" />
      {label ?? t('Discuss in Discord')}
    </button>
  );
}
