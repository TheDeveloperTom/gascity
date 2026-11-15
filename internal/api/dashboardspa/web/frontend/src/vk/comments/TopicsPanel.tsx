import { CaretLeftIcon, CaretRightIcon, XIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { canWrite } from '../../embed/activitySession';
import { refreshPeerBoards } from '../../hooks/usePeerBoards';
import { t, tn } from '../../i18n';
import { asOfClock, type PeerBoardSource } from '../../lib/boardOwner';
import { previewOf, topicSections, topicTarget, unreadIdsOf, waitingOn } from '../../lib/peerTopics';
import type { PeerComment, PeerTopic } from '../../supervisor/peerBoardReads';
import {
  commentErrorText,
  markTopicRead,
  postTopicAction,
  type TopicAction,
  type TopicTarget,
} from '../../supervisor/peerCommentWrites';
import { cn } from '../cn';
import { DiscussButton } from '../DiscussButton';
import { authorName, CommentComposer, CommentList } from './CommentThread';

// vk-final part 4: «Обсуждения Мэров» with the peer city (frames
// General-Thread and Phone-Topics; COMMENTS-PLAN Revision 2). Topics are
// conversations between the Mayors; people watch and can step in («Вмешаться…»).
// One topic is one question and closes when it is resolved; a resolved topic
// stays readable and muted (no delete), and a new human message reopens it.
// Desktop: list and thread side by side; phone: the list leads into the
// thread, and the composer sits pinned right above the tab bar.
// People only step in (sync/topics c664ac8f): message, «Продолжить», «Решено»
// and read stamps; they do not open, pause, reopen or react. Every action is
// sent only through topicTarget (security scan 15.11): the topic must come
// from this peer's board and be owned by that peer or by us.

export interface TopicsPanelProps {
  open: boolean;
  onClose: () => void;
  /** The peer whose board the topics come from. */
  peer: PeerBoardSource;
  topics: readonly PeerTopic[];
  selectedTopicId: string | null;
  onSelectTopic: (topicId: string | null) => void;
  nowMs: number;
  /** Our login from our city service (`own_login`); null = only the peer's own topics are writable. */
  ownLogin?: string | null;
}

/** The resolution reason in the list («→ решено») and on the banner. */
const RESOLUTION_LABEL: Readonly<Record<string, string>> = {
  resolved: 'resolution.resolved',
  outdated: 'resolution.outdated',
  duplicate: 'resolution.duplicate',
};
const RESOLVED_BANNER: Readonly<Record<string, string>> = {
  resolved: 'Resolved · {time} — a new message reopens it',
  outdated: 'Outdated · {time} — a new message reopens it',
  duplicate: 'A duplicate · {time} — a new message reopens it',
};

function CheckGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 4v8M10 4v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function NeedsHumanBanner({
  onContinue,
  onDecide,
  writable,
}: {
  onContinue: () => void;
  onDecide: () => void;
  writable: boolean;
}) {
  return (
    <div role="status" className="flex flex-col gap-2 rounded-sm bg-warn/15 p-2 text-[13px] font-medium text-warn">
      <span>{t('The Mayors did not agree — a person is needed')}</span>
      {writable && (
        <span className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={onContinue}
            className="h-11 rounded-sm border border-vk-border bg-vk-bg-primary px-2.5 text-[13px] font-normal text-vk-text-high focus-mark md:h-7"
          >
            {t('Continue')}
          </button>
          <button
            type="button"
            onClick={onDecide}
            className="h-11 rounded-sm bg-vk-brand-secondary px-2.5 text-[13px] font-medium text-vk-on-brand focus-mark md:h-7"
          >
            {t('Decide myself')}
          </button>
        </span>
      )}
    </div>
  );
}

function SectionHead({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between px-1 pb-1 pt-3 text-sm font-medium text-vk-text-high first:pt-1">
      <span>{label}</span>
      <span className="font-normal text-vk-text-low">{count}</span>
    </div>
  );
}

/** Reads a stamp only for a message that was actually on screen (not merely loaded). */
function useReadStamps(topic: PeerTopic | null, target: TopicTarget | null) {
  const sent = useRef(new Map<string, string>());
  const observer = useRef<IntersectionObserver | null>(null);
  const unread = useMemo(() => (topic === null ? new Set<string>() : unreadIdsOf(topic)), [topic]);
  const byId = useMemo(() => new Map(topic?.messages.map((m) => [m.id, m]) ?? []), [topic]);
  const city = target?.city ?? null;

  useEffect(() => {
    if (topic === null || city === null || unread.size === 0 || typeof IntersectionObserver === 'undefined') return;
    const topicId = topic.topicId;
    const stampTarget: TopicTarget = { city, topicId };
    observer.current = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = (entry.target as HTMLElement).dataset.commentId ?? '';
        const msg = byId.get(id);
        if (msg === undefined) continue;
        const last = sent.current.get(topicId);
        if (last !== undefined && last >= msg.createdAt) continue;
        sent.current.set(topicId, msg.createdAt);
        void markTopicRead(stampTarget, msg.createdAt).catch(() => undefined);
      }
    }, { threshold: 0.6 });
    return () => {
      observer.current?.disconnect();
      observer.current = null;
    };
  }, [topic, city, unread, byId]);

  const itemRef = useCallback(
    (comment: PeerComment) =>
      unread.has(comment.id)
        ? (node: HTMLDivElement | null) => {
            if (node !== null) observer.current?.observe(node);
          }
        : undefined,
    [unread],
  );
  return { unread, itemRef };
}

function TopicView({
  topic,
  peer,
  nowMs,
  writable: canAct,
  ownLogin,
  send,
  onBack,
  composerRef,
}: {
  topic: PeerTopic;
  peer: PeerBoardSource;
  nowMs: number;
  writable: boolean;
  ownLogin: string | null;
  send: (target: TopicTarget, action: TopicAction) => Promise<void>;
  onBack: () => void;
  composerRef: RefObject<HTMLTextAreaElement>;
}) {
  // never a guess: this peer's board, owned by this peer or by us
  const guarded = topicTarget(topic, peer.login, peer.login, ownLogin);
  const writable = canAct && guarded !== null;
  const target: TopicTarget = guarded ?? { city: '', topicId: topic.topicId };
  const closed = topic.status === 'resolved' || topic.status === 'rejected';
  const [resolving, setResolving] = useState(false);
  const [outcome, setOutcome] = useState('');
  const outcomeId = useId();
  const { unread, itemRef } = useReadStamps(topic, writable ? guarded : null);
  const acks = useMemo(
    () => new Set(topic.reactions.filter((r) => r.kind === 'ack').map((r) => r.messageId)),
    [topic.reactions],
  );
  const opener = topic.openedBy;
  const openerSide = opener !== null && opener.city === peer.login ? 'peer' : 'mine';
  const waiting = waitingOn(topic);
  const lastId = topic.messages.at(-1)?.id;
  const resolution = topic.resolution;
  const [error, setError] = useState<string | null>(null);
  const act = (action: TopicAction, then?: () => void) => {
    setError(null);
    send(target, action).then(then, (err: unknown) => setError(commentErrorText(err)));
  };

  return (
    <section aria-label={t('Topic')} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-none flex-wrap items-center justify-between gap-2 border-b border-vk-border px-3 py-2">
        <div className="flex min-w-0 items-start gap-1">
          <button
            type="button"
            onClick={onBack}
            aria-label={t('Back to the topics')}
            className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-vk-text-low focus-mark md:hidden"
          >
            <CaretLeftIcon size={18} weight="bold" aria-hidden="true" />
          </button>
          <div className="flex min-w-0 flex-col">
            <h2 className="text-lg font-medium text-vk-text-high [overflow-wrap:anywhere]">{topic.title}</h2>
            <span className="text-[13px] text-vk-text-low">
              {t('opened by {who} · {time} · people see it and can step in', {
                who: opener === null ? peer.name : authorName(opener, openerSide, { peerLabel: peer.label }),
                time: asOfClock(topic.openedAt ?? ''),
              })}
            </span>
          </div>
        </div>
        {writable && !closed && (
          <DiscussButton
            ctx={{
              kind: 'need',
              beadId: topic.topicId,
              title: t('Make a task: {title}', { title: topic.title }),
              summary: previewOf(topic),
            }}
            label={t('Make a task')}
            className="md:w-auto"
          />
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {topic.status === 'paused' && topic.pausedReason === 'needs_human' && (
          <NeedsHumanBanner
            writable={writable}
            onContinue={() => act({ action: 'continue' })}
            onDecide={() => composerRef.current?.focus()}
          />
        )}
        {topic.status === 'paused' && topic.pausedReason !== 'needs_human' && (
          <div className="flex flex-wrap items-center gap-2 rounded-sm border border-vk-border bg-vk-bg-secondary p-2 text-[13px] text-vk-text-normal">
            <span className="flex text-warn">
              <PauseGlyph />
            </span>
            <span className="flex-1">{t('Topic paused')}</span>
            {writable && (
              <button
                type="button"
                onClick={() => act({ action: 'continue' })}
                className="h-11 rounded-sm border border-vk-border bg-vk-bg-primary px-2.5 text-[13px] text-vk-text-high focus-mark md:h-7"
              >
                {t('Continue')}
              </button>
            )}
          </div>
        )}
        {topic.status === 'rejected' && (
          <div className="rounded-sm border border-vk-border bg-vk-bg-secondary p-2 text-[13px] text-vk-text-low">
            {t('rejected by the other city')}
          </div>
        )}
        {resolution !== null && topic.status === 'resolved' && (
          <div
            data-testid="topic-resolved"
            className="flex flex-col gap-1 rounded-sm border border-vk-border bg-vk-bg-secondary p-2 text-[13px] text-vk-text-low"
          >
            <span>
              {t(RESOLVED_BANNER[resolution.reason] ?? RESOLVED_BANNER.resolved!, {
                time: asOfClock(resolution.at ?? topic.resolvedAt ?? ''),
              })}
            </span>
            {resolution.summary !== null && <span className="text-vk-text-normal">{resolution.summary}</span>}
            {resolution.decidingMessageId !== null && (
              <a href={`#comment-${resolution.decidingMessageId}`} className="self-start underline underline-offset-2 focus-mark">
                {t('to the decision')}
              </a>
            )}
          </div>
        )}
        <div className={cn(closed && 'opacity-70')}>
          <CommentList
            comments={topic.messages}
            nowMs={nowMs}
            peerLabel={peer.label}
            acks={acks}
            unread={unread}
            itemRef={itemRef}
            noteOf={(m) =>
              m.id === lastId && waiting !== null ? (
                <span className="inline-flex items-center gap-1.5 self-start rounded-sm bg-warn/15 px-2 py-0.5 text-[13px] text-warn">
                  {waiting.kind === 'person'
                    ? t('waiting for a reply from {owner} since {time}', { owner: peer.label, time: asOfClock(waiting.since) })
                    : t('waiting for a reply from the Mayor of {owner} since {time}', {
                        owner: peer.label,
                        time: asOfClock(waiting.since),
                      })}
                </span>
              ) : null
            }
          />
        </div>
      </div>

      {writable && (
        <div
          className="flex flex-none flex-col gap-2 border-t border-vk-border px-3 pt-2"
          style={{ paddingBottom: 'calc(0.75rem + var(--saib, env(safe-area-inset-bottom)))' }}
        >
          {!closed && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-expanded={resolving}
                onClick={() => setResolving((v) => !v)}
                className="inline-flex h-11 items-center gap-1.5 rounded-sm border border-vk-border bg-vk-bg-secondary px-2.5 text-sm text-vk-text-high focus-mark md:h-8"
              >
                {t('Resolved ✓')}
              </button>
            </div>
          )}
          {!closed && resolving && (
            // the contract needs a one-line outcome with every resolve
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={outcomeId} className="sr-only">
                {t('One-line outcome')}
              </label>
              <input
                id={outcomeId}
                value={outcome}
                maxLength={200}
                placeholder={t('One-line outcome')}
                onChange={(e) => setOutcome(e.target.value)}
                className="h-11 min-w-0 flex-1 rounded-sm border border-vk-border bg-vk-bg-secondary px-2 text-base text-vk-text-high focus-mark md:h-8"
              />
              <button
                type="button"
                disabled={outcome.trim().length === 0}
                onClick={() =>
                  act({ action: 'resolve', reason: 'resolved', summary: outcome.trim() }, () => {
                    setResolving(false);
                    setOutcome('');
                  })
                }
                className="h-11 rounded-sm bg-vk-brand-secondary px-3 text-sm font-medium text-vk-on-brand focus-mark disabled:opacity-50 md:h-8"
              >
                {t('Close the topic')}
              </button>
            </div>
          )}
          {error !== null && (
            <p role="alert" className="text-sm text-vk-error">
              {error}
            </p>
          )}
          <CommentComposer
            label={t('Message to the topic')}
            placeholder={t('Step in: write to the topic…')}
            hint={t('both Mayors and {name} will see it', { name: peer.name })}
            onSubmit={(text) => send(target, { action: 'message', text })}
            errorText={commentErrorText}
            textareaRef={composerRef}
          />
        </div>
      )}
    </section>
  );
}

export function TopicsPanel({
  open,
  onClose,
  peer,
  topics,
  selectedTopicId,
  onSelectTopic,
  nowMs,
  ownLogin = null,
}: TopicsPanelProps) {
  const writable = canWrite();
  const [showResolved, setShowResolved] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const sections = useMemo(() => topicSections(topics, nowMs), [topics, nowMs]);
  const selected = topics.find((tp) => tp.topicId === selectedTopicId) ?? null;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const send = useCallback(async (target: TopicTarget, action: TopicAction) => {
    await postTopicAction(target, action);
    void refreshPeerBoards();
  }, []);

  if (!open) return null;
  const showPane = selected !== null;

  const row = (tp: PeerTopic, extra?: ReactNode) => (
    <button
      key={tp.topicId}
      type="button"
      aria-current={tp.topicId === selectedTopicId ? 'true' : undefined}
      onClick={() => onSelectTopic(tp.topicId)}
      className={cn(
        'flex min-h-11 w-full flex-col gap-0.5 rounded-sm border p-2 text-left focus-mark',
        tp.topicId === selectedTopicId ? 'border-vk-brand bg-vk-bg-primary' : 'border-vk-border bg-vk-bg-primary',
      )}
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-[15px] text-vk-text-high [overflow-wrap:anywhere]">{tp.title}</span>
        {tp.unreadCount > 0 && (
          <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-vk-brand-secondary px-1.5 text-[11px] font-semibold text-vk-on-brand">
            {tn(tp.unreadCount, { one: '{n} new', other: '{n} new messages' })}
          </span>
        )}
      </span>
      {extra ?? <span className="text-[13px] text-vk-text-low [overflow-wrap:anywhere]">{previewOf(tp)}</span>}
    </button>
  );

  return (
    <div className="fixed inset-0 bottom-[calc(3.5rem+var(--saib))] z-50 bg-scrim/50 md:bottom-0" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('Mayor topics')}
        onClick={(e) => e.stopPropagation()}
        className="fixed inset-0 bottom-[calc(3.5rem+var(--saib))] flex bg-vk-bg-primary font-vk-sans text-vk-text-normal shadow-overlay md:bottom-0 md:left-auto md:w-[1040px] md:max-w-full md:border-l md:border-vk-border"
      >
        <nav
          aria-label={t('Topics')}
          className={cn(
            'flex min-h-0 w-full flex-col border-vk-border bg-vk-bg-secondary md:flex md:w-[340px] md:flex-none md:border-r',
            showPane && 'hidden',
          )}
        >
          <div className="flex min-h-11 items-center justify-between gap-2 border-b border-vk-border py-1 pl-3 pr-1">
            <span className="flex min-w-0 flex-col md:flex-row md:items-baseline md:gap-2">
              <span className="font-medium text-vk-text-high">{t('Mayor topics')}</span>
              <span className="text-[13px] text-vk-text-low">{t('with {owner} city', { owner: peer.label })}</span>
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('Close')}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-vk-text-low focus-mark hover:text-vk-text-high"
            >
              <XIcon size={18} weight="bold" aria-hidden="true" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
            <SectionHead label={t('Open topics')} count={sections.open.length} />
            {sections.open.length === 0 && <p className="px-1 text-sm text-vk-text-low">{t('No open topics.')}</p>}
            {sections.open.map((tp) => row(tp))}
            {sections.paused.length > 0 && (
              <>
                <SectionHead label={t('Paused')} count={sections.paused.length} />
                {sections.paused.map((tp) => (
                  <div key={tp.topicId} className="flex flex-col gap-2 rounded-sm border border-vk-border bg-vk-bg-primary p-2">
                    <button
                      type="button"
                      onClick={() => onSelectTopic(tp.topicId)}
                      className="flex min-h-11 items-center gap-2 text-left focus-mark md:min-h-0"
                    >
                      <span className="flex text-warn">
                        <PauseGlyph />
                      </span>
                      <span className="min-w-0 flex-1 text-[15px] text-vk-text-high">{tp.title}</span>
                    </button>
                    {tp.pausedReason === 'needs_human' ? (
                      <NeedsHumanBanner
                        writable={writable && topicTarget(tp, peer.login, peer.login, ownLogin) !== null}
                        onContinue={() => {
                          const target = topicTarget(tp, peer.login, peer.login, ownLogin);
                          if (target !== null) void send(target, { action: 'continue' }).catch(() => undefined);
                        }}
                        onDecide={() => {
                          onSelectTopic(tp.topicId);
                          requestAnimationFrame(() => composerRef.current?.focus());
                        }}
                      />
                    ) : (
                      <span className="text-[13px] text-vk-text-low">{t('paused by a person')}</span>
                    )}
                  </div>
                ))}
              </>
            )}
            <button
              type="button"
              aria-expanded={showResolved}
              onClick={() => setShowResolved((v) => !v)}
              className="mt-2 flex min-h-11 items-center justify-between rounded-sm px-1 text-left text-sm font-medium text-vk-text-high focus-mark md:min-h-8"
            >
              <span className="flex items-center gap-1.5">
                <CaretRightIcon size={12} weight="bold" aria-hidden="true" className={cn(showResolved && 'rotate-90')} />
                {t('Resolved · 14 days')}
              </span>
              <span className="font-normal text-vk-text-low">{sections.resolved.length}</span>
            </button>
            {showResolved &&
              sections.resolved.map((tp) =>
                row(
                  tp,
                  <span className="flex items-center gap-1.5 text-[13px] text-vk-text-low">
                    <span className="flex text-vk-success">
                      <CheckGlyph />
                    </span>
                    {tp.ticket !== null
                      ? t('→ task {id}', { id: tp.ticket })
                      : tp.status === 'rejected'
                        ? `→ ${t('rejected by the other city')}`
                        : `→ ${tp.resolution?.summary ?? t(RESOLUTION_LABEL[tp.resolution?.reason ?? 'resolved'] ?? '')}`}
                  </span>,
                ),
              )}
          </div>
        </nav>

        <div className={cn('min-h-0 min-w-0 flex-1 flex-col', showPane ? 'flex' : 'hidden md:flex')}>
          {selected !== null ? (
            <TopicView
              topic={selected}
              peer={peer}
              nowMs={nowMs}
              writable={writable}
              ownLogin={ownLogin}
              send={send}
              onBack={() => onSelectTopic(null)}
              composerRef={composerRef}
            />
          ) : (
            <p className="m-auto p-6 text-sm text-vk-text-low">{t('Pick a topic on the left.')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
