import { useId, useMemo, useState, type ReactNode } from 'react';
import { useReadOnly } from '../../contexts/ReadOnlyContext';
import { canWrite } from '../../embed/activitySession';
import { refreshPeerBoards } from '../../hooks/usePeerBoards';
import { t } from '../../i18n';
import type { PeerBoardSource } from '../../lib/boardOwner';
import type { CardTopic } from '../../lib/peerTopics';
import type { PeerComment, PeerTopic } from '../../supervisor/peerBoardReads';
import { commentErrorText, postCardMessage } from '../../supervisor/peerCommentWrites';
import { CardTopics } from './CardTopics';
import { CommentComposer, CommentList } from './CommentThread';

// vk-final (owner, 15.11, refined): every card — ours and the peer's — gets a
// plain comment box pinned at the bottom of its drawer, vibe-kanban style.
// There is no separate comment channel: the card's conversation IS a Mayor
// topic linked to the card (`topic.card`). The thread under the card shows
// that whole topic (Mayors and people, with their author kinds). The box
// sends one call, `/v1/topics/card-message` (sync/topics c664ac8f): the city
// posts into the card's topic with that peer, or opens one linked to the card.
//
// Security scan 15.11: the box never guesses where a message goes. His card
// goes to him (the city takes the card's city). Our card goes to the peer
// whose board carries the card's current topic; with no topic, to the only
// peer, or to the one the person picks («Кому») when there are several; with
// no peer, or our login unknown, there is no box.

export interface CardConversationProps {
  /** Topics linked to this card, newest activity first (topicsForCard, trusted keys). */
  topics: readonly CardTopic[];
  /** His card: [him]. Our card: every peer board. */
  peers: readonly PeerBoardSource[];
  /** The card as the city addresses it; `city` null = unknown (no box). */
  card: { city: string | null; rig: string; id: string; title: string };
  /** Our own card. */
  ours: boolean;
  nowMs: number;
  onOpenTopic: (login: string, topicId: string) => void;
  /** Lays out the two parts: the thread goes in the drawer body, the box in its footer. */
  children: (parts: { thread: ReactNode; composer: ReactNode | null; count: number }) => ReactNode;
}

const NONE: readonly PeerComment[] = [];
/** A served copy may carry a server time a little before our click (clock skew). */
const PENDING_SKEW_MS = 120_000;

/**
 * The thread with our just-sent messages (review M-8): each served message of
 * ours with the same text, not older than the send, replaces ONE pending row,
 * so two identical sends stay two rows until both are served.
 */
export function mergePending(served: readonly PeerComment[], pending: readonly PeerComment[]): PeerComment[] {
  const used = new Set<string>();
  const left = pending.filter((p) => {
    const sentAt = Date.parse(p.createdAt);
    const copy = served.find(
      (s) =>
        s.mine &&
        !used.has(s.id) &&
        s.text === p.text &&
        (!Number.isFinite(sentAt) || Date.parse(s.createdAt) >= sentAt - PENDING_SKEW_MS),
    );
    if (copy === undefined) return true;
    used.add(copy.id);
    return false;
  });
  return [...served, ...left];
}

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

export function CardConversation({ topics, peers, card, ours, nowMs, onOpenTopic, children }: CardConversationProps) {
  const pickId = useId();
  const readOnly = useReadOnly();
  const [pending, setPending] = useState<readonly PeerComment[]>(NONE);
  const [picked, setPicked] = useState<string>('');
  const current = currentOf(topics);
  const others = topics.filter((ct) => ct !== current);
  const served = current?.topic.messages ?? NONE;
  const messages = useMemo(() => mergePending(served, pending), [served, pending]);
  const acks = useMemo(
    () => new Set((current?.topic.reactions ?? []).filter((r) => r.kind === 'ack').map((r) => r.messageId)),
    [current],
  );

  // Who the message goes to (never a guess).
  const needsPick = ours && current === null && peers.length > 1;
  const toLogin: string | null = !ours
    ? (peers[0]?.login ?? null)
    : current !== null
      ? current.login
      : peers.length === 1
        ? (peers[0]?.login ?? null)
        : picked !== ''
          ? picked
          : null;
  const toPeer = peers.find((p) => p.login === toLogin) ?? null;
  const cardCity = card.city;
  const canSend = cardCity !== null && toLogin !== null && peers.some((p) => p.login === toLogin);

  const submit = async (text: string) => {
    if (!canSend || cardCity === null || toLogin === null) return;
    // his card: the city addresses it by the card's own city; our card names the peer
    await postCardMessage({ city: cardCity, rig: card.rig, id: card.id }, text, ours ? toLogin : undefined);
    setPending((prev) => [
      ...prev,
      {
        id: `pending-${Date.now()}`,
        mine: true,
        author: { kind: 'person', city: null, name: t('You'), agent: null, displayName: null, avatarUrl: null },
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
        <CommentList comments={messages} nowMs={nowMs} peerLabel={toPeer?.label ?? peers[0]?.label ?? ''} acks={acks} />
      )}
      {others.length > 0 && <CardTopics topics={others} onOpen={onOpenTopic} />}
    </section>
  );

  // review M-5: the dashboard's read-only posture hides the box like any other write
  const showBox = canWrite() && !readOnly && cardCity !== null && peers.length > 0;
  const composer = !showBox ? null : (
    <div className="flex flex-col gap-2">
      {needsPick && (
        <div className="flex items-center gap-2 text-sm text-vk-text-normal">
          <label htmlFor={pickId}>{t('To')}</label>
          <select
            id={pickId}
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            className="h-11 min-w-0 flex-1 rounded-sm border border-vk-border bg-vk-bg-secondary px-2 text-base text-vk-text-high focus-mark md:h-8"
          >
            <option value="">{t('Choose a city…')}</option>
            {peers.map((p) => (
              <option key={p.login} value={p.login}>
                {t('{owner} city', { owner: p.label })}
              </option>
            ))}
          </select>
        </div>
      )}
      <CommentComposer
        label={t('Comment on the card')}
        placeholder={
          !ours && toPeer !== null
            ? toPeer.dative !== null
              ? t('Write to {name}…', { name: toPeer.dative })
              : t('Write to {owner} city…', { owner: toPeer.label })
            : t('Write to the Mayors…')
        }
        hint={
          toPeer !== null ? t('both Mayors and {name} will see it', { name: toPeer.name }) : t('Choose whom to write to.')
        }
        disabled={!canSend}
        onSubmit={submit}
        errorText={commentErrorText}
      />
    </div>
  );

  return <>{children({ thread, composer, count: served.length })}</>;
}
