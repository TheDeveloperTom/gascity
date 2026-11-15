import { StatusBadge } from '../StatusBadge';
import { PROMPT_INJECTION_NOTICE } from '../../lib/constants';
import { formatMailSender } from '../../lib/mailSender';
import type { AttentionSeverity } from '../../attention/compose';
import type { SupervisorMailItem } from '../../supervisor/mailReads';

export function ThreadMessage({
  message,
  attentionSeverity = null,
}: {
  message: SupervisorMailItem;
  attentionSeverity?: AttentionSeverity | null;
}) {
  return (
    <article {...attentionAttrs(attentionSeverity)} className="space-y-2">
      <header className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 truncate text-label text-fg-muted">
          <span className="font-semibold text-fg">{formatMailSender(message.from)}</span>
          <span className="mx-1.5 text-fg-faint">→</span>
          <span>{formatMailSender(message.to)}</span>
        </div>
        <span className="shrink-0 text-label text-fg-faint tnum">
          {formatAbsolute(message.created_at)}
        </span>
      </header>
      <p className="text-body font-semibold text-fg [overflow-wrap:anywhere]">{message.subject}</p>
      {/* Inline, so the notice reads as a sentence. It wraps on phones
          rather than truncating: a cut-off warning is not a warning. */}
      <StatusBadge tone="warn" variant="inline" wrap label={PROMPT_INJECTION_NOTICE} />

      <pre className="max-w-[70ch] pt-1 font-sans text-reading whitespace-pre-wrap text-fg [overflow-wrap:anywhere]">
        {message.body}
      </pre>
    </article>
  );
}

function attentionAttrs(severity: AttentionSeverity | null): {
  'data-attention-severity'?: AttentionSeverity;
} {
  return severity === null ? {} : { 'data-attention-severity': severity };
}

function formatAbsolute(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '·';
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
