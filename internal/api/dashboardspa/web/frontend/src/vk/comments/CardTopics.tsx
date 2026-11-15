import { t, tn } from '../../i18n';
import { asOfClock } from '../../lib/boardOwner';
import { PREVIEW_MAX, type CardTopic } from '../../lib/peerTopics';
import type { PeerTopic } from '../../supervisor/peerBoardReads';
import { cn } from '../cn';

// vk-final (owner, 15.11): no human comments on cards — the Mayors do the
// work, and a card conversation is a Mayor topic linked to that card
// (`topic.card`). A card window lists those topics; each opens the topic
// view, where «Вмешаться…» is the only composer. Shown on his cards always,
// and on OUR cards when a topic references them.

function stateOf(topic: PeerTopic): { label: string; tone: 'open' | 'warn' | 'done' } {
  switch (topic.status) {
    case 'open':
      return { label: t('Topic state: open'), tone: 'open' };
    case 'paused':
      return topic.pausedReason === 'needs_human'
        ? { label: t('Topic state: the Mayors did not agree'), tone: 'warn' }
        : { label: t('Topic state: paused'), tone: 'warn' };
    case 'resolved':
      return { label: t('Topic state: resolved'), tone: 'done' };
    case 'rejected':
      return { label: t('Topic state: rejected'), tone: 'done' };
  }
}

function lastLine(topic: PeerTopic): string {
  const last = topic.messages.at(-1);
  const text = (last?.summary ?? last?.text ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= PREVIEW_MAX ? text : `${text.slice(0, PREVIEW_MAX - 1)}…`;
}

export interface CardTopicsProps {
  topics: readonly CardTopic[];
  onOpen: (login: string, topicId: string) => void;
  /** His card: say so when there is no topic yet. Mine: render nothing. */
  showEmpty?: boolean;
}

export function CardTopics({ topics, onOpen, showEmpty = false }: CardTopicsProps) {
  if (topics.length === 0 && !showEmpty) return null;
  return (
    <section
      aria-label={t('Mayor topics about this card')}
      className="flex flex-col gap-2 border-t border-vk-border pt-2"
    >
      <h3 className="flex items-center gap-1.5 py-1 text-base font-medium text-vk-text-normal">
        {t('Mayor topics about this card')}
        {topics.length > 0 && <span className="font-normal text-vk-text-low">{topics.length}</span>}
      </h3>
      {topics.length === 0 ? (
        <p className="text-sm text-vk-text-low">{t('No Mayor topics about this card yet.')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {topics.map(({ login, topic }) => {
            const state = stateOf(topic);
            const last = lastLine(topic);
            const lastMessage = topic.messages.at(-1);
            return (
              <li key={`${login}:${topic.topicId}`}>
                <button
                  type="button"
                  onClick={() => onOpen(login, topic.topicId)}
                  className="flex min-h-11 w-full flex-col gap-1 rounded-sm border border-vk-border bg-vk-bg-primary p-2 text-left focus-mark hover:bg-vk-bg-secondary"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 text-[15px] text-vk-text-high [overflow-wrap:anywhere]">
                      {topic.title}
                    </span>
                    {topic.unreadCount > 0 && (
                      <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-vk-brand-secondary px-1.5 text-[11px] font-semibold text-vk-on-brand">
                        {tn(topic.unreadCount, { one: '{n} new', other: '{n} new messages' })}
                      </span>
                    )}
                    <span
                      className={cn(
                        'inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-xs',
                        state.tone === 'warn'
                          ? 'bg-warn/15 text-warn'
                          : state.tone === 'done'
                            ? 'bg-vk-bg-panel text-vk-text-low'
                            : 'bg-vk-bg-panel text-vk-text-normal',
                      )}
                    >
                      {state.label}
                    </span>
                  </span>
                  {last.length > 0 && (
                    <span className="text-[13px] text-vk-text-low [overflow-wrap:anywhere]">
                      {lastMessage !== undefined && `${asOfClock(lastMessage.createdAt)} · `}
                      {last}
                    </span>
                  )}
                  {topic.resolution?.summary != null && (
                    <span className="text-[13px] text-vk-text-normal [overflow-wrap:anywhere]">
                      → {topic.resolution.summary}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
