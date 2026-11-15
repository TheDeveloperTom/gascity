import { XIcon } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { t } from '../i18n';

// vk-final part 5: one short message at the bottom of the screen (above the
// phone's tab bar), gone after a few seconds or on «×».

export const TOAST_MS = 6000;

export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const handle = window.setTimeout(onDone, TOAST_MS);
    return () => window.clearTimeout(handle);
  }, [text, onDone]);
  return (
    <div
      role="status"
      aria-label={t('Notice')}
      className="fixed inset-x-4 bottom-[calc(4.5rem+var(--saib))] z-[60] mx-auto flex max-w-md items-start gap-2 rounded-sm border border-vk-border bg-vk-bg-primary px-3 py-2 font-vk-sans text-[15px] text-vk-text-high shadow-overlay md:bottom-6"
    >
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{text}</span>
      <button
        type="button"
        onClick={onDone}
        aria-label={t('Close')}
        className="-my-1 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-vk-text-low focus-mark md:h-8 md:w-8"
      >
        <XIcon size={16} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
}
