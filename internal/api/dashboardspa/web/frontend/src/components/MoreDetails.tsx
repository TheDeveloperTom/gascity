import type { ReactNode } from 'react';
import { t } from '../i18n';

interface MoreDetailsProps {
  /** The engine's own words (EngineText.raw); shown only when opened. */
  raw?: string | null;
  /** The summary word; «подробнее» by default. */
  label?: string;
  children?: ReactNode;
}

// «подробнее» (Global Constraints): the only place engine text appears on an
// owner page. Closed by default; renders nothing when there is nothing to show.
export function MoreDetails({ raw, label, children }: MoreDetailsProps) {
  const hasRaw = typeof raw === 'string' && raw.trim().length > 0;
  if (!hasRaw && (children === undefined || children === null)) return null;
  return (
    <details className="text-label text-fg-muted">
      <summary className="cursor-pointer select-none focus-mark">
        {label ?? t('more details')}
      </summary>
      <div className="mt-1 space-y-1">
        {hasRaw && <p className="whitespace-pre-wrap break-words">{raw}</p>}
        {children}
      </div>
    </details>
  );
}
