import { useMemo, useState, type ReactNode } from 'react';
import { canWrite } from '../../embed/activitySession';
import { refreshPeerBoards } from '../../hooks/usePeerBoards';
import { t } from '../../i18n';
import type { PeerBoardSource } from '../../lib/boardOwner';
import type { CardTopic } from '../../lib/peerTopics';
import type { PeerComment, PeerTopic } from '../../supervisor/peerBoardReads';
import { commentErrorText, openCardTopic, postTopicAction } from '../../supervisor/peerCommentWrites';
import { CardTopics } from './CardTopics';
import { CommentComposer, CommentList } from './CommentThread';

// vk-final (owner, 15.11, refined): every card — ours and the peer's — gets a
// plain comment box pinned at the bottom of its drawer, vibe-kanban style.
// There is no separate comment channel: the card's conversation IS a Mayor
// topic linked to the card (`topic.card`). The thread under the card shows
// that whole topic (Mayors and people, with their author kinds); the first
// message on a card with no thread silently opens such a topic, and later
// messages go into it.

export interface CardConversationProps {
  /** Topics linked to this card, newest activity first (topicsForCard). */
  topics: readonly CardTopic[];
  /** Who the box writes to: his card's peer, or for our card the peer we talk with; null = no box. */
  peer: PeerBoardSource | null;
  /** The card itself, as the city addresses it. */
  card: { city: string; rig: string; id: string; title: string };
  /** Our own card (the box then writes «to the Mayors»). */
  ours: boolean;
  nowMs: number;
  onOpenTopic: (login: string, topicId: string) => void;
  /** Lays out the two parts: the thread goes in the drawer body, the box in its footer. */
  children: (parts: { thread: ReactNode; composer: ReactNode | null; count: number }) => ReactNode;
}

const NONE: readonly PeerComment[] = [];

/** The card's current topic: the newest one still talking, else the newest closed one. */
function currentOf(topics: readonly CardTopic[]): CardTopic | null {
  const live = topics.find((ct) => ct.topic.status === 'open' || ct.topic.status === 'paused');
  return live ?? topics.find((ct) => ct.topic.status === 'resolved') ?? null;
}

function stateChip(topic: PeerTopic): string {
  if (topic.status === 'paused') {
    return topic.pausedReason === 'needs_human'
      ? t('Topic state: the Mayors did not agree')
      : t('Topic state: paused');
  }
  return topic.status === 'resolved' ? t('Topic state: resolved') : t('Topic state: open');
}

export function CardConversation({ topics, peer, card, ours, nowMs, onOpenTopic, children }: CardConversationProps) {
  const [pending, setPending] = useState<readonly PeerComment[]>(NONE);
  const current = currentOf(topics);
  const others = topics.filter((ct) => ct !== current);
  const served = current?.topic.messages ?? NONE;
  const messages = useMemo(() => {
    const ids = new Set(served.map((m) => m.id));
    const texts = new Set(served.filter((m) => m.mine).map((m) => m.text));
    return [...served, ...pending.filter((m) => !ids.has(m.id) && !texts.has(m.text))];
  }, [served, pending]);
  const acks = useMemo(
    () => new Set((current?.topic.reactions ?? []).filter((r) => r.kind === 'ack').map((r) => r.messageId)),
    [current],
  );

  const submit = async (text: string) => {
    if (peer === null) return;
    if (current !== null) {
      // a person's message also un-pauses a paused topic and reopens a resolved one
      await postTopicAction({ city: current.topic.city, topicId: current.topic.topicId }, { action: 'message', text });
    } else {
      await openCardTopic(peer.login, { city: card.city, rig: card.rig, id: card.id }, card.title, text);
    }
    setPending((prev) => [
      ...prev,
      {
        id: `pending-${Date.now()}`,
        mine: true,
        author: { kind: 'person', city: null, name: t('You'), agent: null },
        text,
        summary: null,
        createdAt: new Date().toISOString(),
        state: 'queued',
        reason: null,
        reopened: false,
      },
    ]);
    void refreshPeerBoards();
  };

  const thread = (
    <section aria-label={t('Card conversation')} className="flex flex-col gap-2 border-t border-vk-border pt-2">
      {current !== null && (
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 text-vk-text-normal [overflow-wrap:anywhere]">{current.topic.title}</span>
          <span className="inline-flex h-5 items-center rounded-sm bg-vk-bg-panel px-1.5 text-xs text-vk-text-normal">
            {stateChip(current.topic)}
          </span>
          <button
            type="button"
            onClick={() => onOpenTopic(current.login, current.topic.topicId)}
            className="min-h-11 rounded-sm px-1 text-sm text-vk-text-low underline underline-offset-2 focus-mark hover:text-vk-text-high md:min-h-0"
          >
            {t('Open the topic view')}
          </button>
        </div>
      )}
      {messages.length === 0 ? (
        <p className="text-sm text-vk-text-low">{t('Nobody has written about this card yet.')}</p>
      ) : (
        <CommentList comments={messages} nowMs={nowMs} peerLabel={peer?.label ?? ''} acks={acks} />
      )}
      {others.length > 0 && <CardTopics topics={others} onOpen={onOpenTopic} />}
    </section>
  );

  const composer =
    peer === null || !canWrite() ? null : (
      <CommentComposer
        label={t('Comment on the card')}
        placeholder={
          ours
            ? t('Write to the Mayors…')
            : peer.dative !== null
              ? t('Write to {name}…', { name: peer.dative })
              : t('Write to {owner} city…', { owner: peer.label })
        }
        hint={t('both Mayors and {name} will see it', { name: peer.name })}
        onSubmit={submit}
        errorText={commentErrorText}
      />
    );

  return <>{children({ thread, composer, count: served.length })}</>;
}
