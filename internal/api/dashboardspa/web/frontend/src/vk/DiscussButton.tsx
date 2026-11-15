import { ChatCircleDotsIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { t } from '../i18n';
import { discussWithMayor, mayorChannelUrl, type DiscussContext } from '../lib/discussWithMayor';
import { openExternal } from '../lib/openExternal';
import { isEmbedded } from '../lib/apiBase';
import { canWrite } from '../embed/activitySession';
import { cn } from './cn';

// «Обсудить в Discord» (vk lane 2; lane 3 consumes it). Ruling 3 (Safari/iOS
// popup blocking): the known Mayor channel opens SYNCHRONOUSLY inside the
// click, and the Mayor handoff (`discussWithMayor`) runs in the background.
// Nothing is awaited before the window opens.
// Task 6: hidden for an Activity reader (Richard). Inside the Activity the
// gateway resolves the Discord URL, so VITE_MAYOR_DISCORD_URL is not needed
// there: with no build-time channel, the URL the gateway returns is opened
// through the SDK opener (`openExternalLink`, not a browser popup).

export interface DiscussButtonProps {
  ctx: DiscussContext;
  className?: string;
  /** Visible label; defaults to «Обсудить в Discord». */
  label?: string;
}

type Phase = 'idle' | 'sending' | 'done' | 'error';

export function DiscussButton({ ctx, className, label }: DiscussButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  if (!canWrite()) return null;
  const channel = mayorChannelUrl();
  const embedded = isEmbedded();
  const unconfigured = channel === null && !embedded;

  const onClick = () => {
    if (unconfigured || phase === 'sending') return;
    if (channel !== null) openExternal(channel);
    setPhase('sending');
    discussWithMayor(ctx).then(
      (url) => {
        if (channel === null) openExternal(url);
        setPhase('done');
      },
      () => setPhase('error'),
    );
  };

  const text =
    phase === 'sending'
      ? t('Handing it to the Mayor…')
      : phase === 'done'
        ? t('Opened in Discord')
        : phase === 'error'
          ? t('Did not work — try again')
          : (label ?? t('Discuss in Discord'));

  // Design pass 15.11: a quiet secondary action (ghost, icon + label), never
  // a full-width slab; the card's own primary action keeps the weight.
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-sm font-medium text-vk-text-low transition-colors hover:bg-vk-bg-panel hover:text-vk-text-high disabled:cursor-not-allowed disabled:opacity-60 focus-mark md:h-8',
        className,
      )}
      disabled={unconfigured || phase === 'sending'}
      {...(unconfigured ? { title: t('Mayor channel is not configured') } : {})}
      {...(phase === 'error' ? { role: 'alert' } : {})}
      onClick={onClick}
    >
      <ChatCircleDotsIcon aria-hidden="true" size={16} className="shrink-0" />
      {text}
    </button>
  );
}
