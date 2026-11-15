import { formatRelative } from '../../hooks/time';
import { PROMPT_INJECTION_NOTICE } from '../../lib/constants';
import type { SupervisorMailItem } from '../../supervisor/mailReads';
import { StatusShape } from '../icons';

export function AgentChatThread({
  messages,
  loading,
  error,
  now,
}: {
  messages: ReadonlyArray<SupervisorMailItem>;
  loading: boolean;
  error: string | null;
  now: number;
}) {
  return (
    <section aria-labelledby="agent-chat-title" className="mt-10">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="agent-chat-title" className="text-title font-semibold text-fg">
          Chat thread
        </h2>
        <span className="inline-flex min-w-[1.375rem] justify-center rounded-full bg-fg/[0.06] px-1.5 text-label font-semibold text-fg-muted tnum">
          {loading ? '·' : messages.length}
        </span>
      </header>
      <p className="mb-4 flex items-start gap-2 text-label text-warn">
        <span className="mt-[5px] flex">
          <StatusShape tone="warn" />
        </span>
        <span>{PROMPT_INJECTION_NOTICE}</span>
      </p>
      {loading ? (
        <p className="text-body text-fg-muted">Loading messages.</p>
      ) : error !== null ? (
        <p className="text-body text-accent" role="alert">
          {error}
        </p>
      ) : messages.length === 0 ? (
        <p className="text-body text-fg-muted">No messages between operator and this agent.</p>
      ) : (
        <ul className="divide-y divide-rule rounded-lg border border-rule bg-surface-raised">
          {messages.map((m) => (
            <li key={m.id} className="space-y-1.5 px-4 py-4">
              <header className="flex items-baseline justify-between gap-3">
                <div className="min-w-0 truncate text-label text-fg-muted">
                  <span className="font-semibold text-fg">{m.from}</span>
                  <span className="mx-1.5 text-fg-faint" aria-hidden="true">
                    →
                  </span>
                  <span className="sr-only"> to </span>
                  <span>{m.to}</span>
                </div>
                <span className="shrink-0 text-label text-fg-faint tnum">
                  {formatRelative(m.created_at, now)}
                </span>
              </header>
              {m.subject && <p className="text-body font-semibold text-fg">{m.subject}</p>}
              <pre className="max-w-[70ch] overflow-x-auto whitespace-pre-wrap font-sans text-reading text-fg">
                {m.body}
              </pre>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
