import { useState } from 'react';
import { t } from '../i18n';
import { discussWithMayor, mayorChannelUrl, type DiscussContext } from '../lib/discussWithMayor';
import { openExternal } from '../lib/openExternal';
import { cn } from './cn';

// «Обсудить в Discord» (vk lane 2; lane 3 consumes it). Ruling 3 (Safari/iOS
// popup blocking): the known Mayor channel opens SYNCHRONOUSLY inside the
// click, and the Mayor handoff (`discussWithMayor`) runs in the background.
// Nothing is awaited before the window opens.

export interface DiscussButtonProps {
  ctx: DiscussContext;
  className?: string;
  /** Visible label; defaults to «Обсудить в Discord». */
  label?: string;
}

type Phase = 'idle' | 'sending' | 'done' | 'error';

export function DiscussButton({ ctx, className, label }: DiscussButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const channel = mayorChannelUrl();
  const unconfigured = channel === null;

  const onClick = () => {
    if (channel === null || phase === 'sending') return;
    openExternal(channel);
    setPhase('sending');
    discussWithMayor(ctx).then(
      () => setPhase('done'),
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

  return (
    <button
      type="button"
      className={cn(
        'inline-flex min-h-[44px] w-full items-center justify-center rounded-sm border border-vk-border bg-vk-bg-primary px-3 text-[15px] text-vk-text-high transition-colors hover:bg-vk-bg-secondary disabled:cursor-not-allowed disabled:opacity-60 focus-mark',
        className,
      )}
      disabled={unconfigured || phase === 'sending'}
      {...(unconfigured ? { title: t('Mayor channel is not configured') } : {})}
      {...(phase === 'error' ? { role: 'alert' } : {})}
      onClick={onClick}
    >
      {text}
    </button>
  );
}
