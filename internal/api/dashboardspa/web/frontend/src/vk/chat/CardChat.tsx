import { ArrowUpIcon } from '@phosphor-icons/react';
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useReadOnly } from '../../contexts/ReadOnlyContext';
import { useCardChat, type CardChat as CardChatState, type ChatRow, type SessionLike } from '../../hooks/useCardChat';
import type { BoardChatErrorCode } from '../../supervisor/boardChat';
import { t } from '../../i18n';
import { cn } from '../cn';
import { ShareDialog, shareLabel, type SharePeer } from './ShareDialog';

// BOARD-CHAT Task C4 (owner 19.11 points 2, 5, 6): the private chat on the
// owner's own card. The owner asks; the desk («Дежурный по доске») answers;
// a request to act goes to the Mayor, whose reply lands here too. Only the
// owner and his Mayor see it. There is no «Позвать Мэра» button: the desk
// hands requests over by itself (DOCCHECK DC#15).
//
// While the card's rig or the thread is still loading, the chat shows a
// skeleton in its own place: never another box (the old fallback showed the
// Discord «Сообщение Мэру» box, which looked like deleted comments).

export interface CardChatProps {
  city: string;
  /** The own card; `rig` null while the board's rigs are still loading. */
  card: { rig: string | null; id: string };
  /** The card's title (the share summary starts with it). */
  title?: string;
  /**
   * Task C5: the one peer a summary can be shown to («Показать Ричарду»);
   * null or absent = no share button.
   */
  peer?: SharePeer | null;
  /** The sessions the board reads: replies are told apart by their source session (review I6). */
  sessions?: readonly SessionLike[];
  /**
   * Review Q3: the board knows this card has no chat (its rigs are read and
   * none owns the id, e.g. a run bead): one plain line, never a skeleton.
   */
  noChat?: boolean;
}

/** Review M1: the service takes at most 4000 characters (C2). */
export const CHAT_TEXT_MAX = 4000;

export function CardChat({ city, card, title = '', peer = null, sessions, noChat = false }: CardChatProps) {
  if (noChat) return <NoChat />;
  if (card.rig === null) return <ChatSkeleton />;
  return <LiveCardChat city={city} card={{ rig: card.rig, id: card.id }} title={title} peer={peer} sessions={sessions} />;
}

function NoChat() {
  return <p className="text-sm text-vk-text-low">{t('The chat is for product tasks and epics')}</p>;
}

function ChatSkeleton() {
  return (
    <div data-testid="card-chat-skeleton" aria-busy="true" className="flex w-full flex-col gap-2">
      <span className="sr-only">{t('Loading the chat…')}</span>
      <div className="h-4 w-2/3 animate-pulse rounded-sm bg-vk-bg-panel" />
      <div className="h-4 w-1/2 animate-pulse rounded-sm bg-vk-bg-panel" />
      <div className="h-11 w-full animate-pulse rounded-sm bg-vk-bg-panel" />
    </div>
  );
}

function whoName(who: ChatRow['who']): string {
  if (who === 'owner') return t('You, in the card chat');
  return who === 'mayor' ? t('Mayor') : t('Desk');
}

/** Review M1: why a turn was refused, in plain words. */
function refusal(code: BoardChatErrorCode | undefined): string {
  switch (code) {
    case 'too_long':
    case 'too_large':
      return t('not delivered: longer than {max} characters', { max: CHAT_TEXT_MAX });
    case 'not_owner':
      return t('not delivered: only the board owner can write here');
    case 'unavailable':
      return t('not delivered: the chat is unavailable now');
    case 'own_login_unknown':
      return t('not delivered: the city does not know whose board this is');
    case 'server_error':
    case 'outbox_unreadable':
      return t('not delivered: the chat service failed');
    case 'bad_request':
    case 'unsupported_media_type':
      return t('not delivered: the chat did not accept the message');
    default:
      return t('not delivered');
  }
}

function RowState({ row, who, onRetry }: { row: ChatRow; who: CardChatState['who']; onRetry: () => void }) {
  switch (row.state) {
    case 'sending':
    case 'queued':
      return <span className="text-sm font-light text-vk-text-low">{t('sending')}</span>;
    case 'delivered':
      return <span className="text-sm font-light text-vk-text-low">{t('delivered')}</span>;
    case 'reading':
      return (
        <span className="text-sm font-light text-vk-text-low">
          {who === 'mayor' ? t('The Mayor is working — he will answer here') : t('The desk is reading…')}
        </span>
      );
    case 'failed':
      return (
        <span className="flex items-center gap-2 text-sm">
          <span className="font-light text-vk-error">{refusal(row.error)}</span>
          {row.retryable !== false && (
            <button
              type="button"
              onClick={onRetry}
              className="min-h-11 rounded-sm px-1 text-vk-text-normal underline underline-offset-2 focus-mark hover:text-vk-text-high md:min-h-0"
            >
              {t('retry')}
            </button>
          )}
        </span>
      );
    default:
      return null;
  }
}

/** The line under the thread about the agent that holds the conversation (DC#25). */
function agentLine(chat: CardChatState): string | null {
  if (chat.agentActivity !== 'in-turn') return null;
  // a «reading» row already says it
  if (chat.rows.some((r) => r.state === 'reading')) return null;
  if (chat.who === 'mayor') return t('The Mayor is working — he will answer here');
  // the desk serves every card: busy while this card is not being read = another question
  if (chat.rows.length === 0) return null;
  return t('The desk is answering another question');
}

interface LiveProps {
  city: string;
  card: { rig: string; id: string };
  title: string;
  peer: SharePeer | null;
  sessions: readonly SessionLike[] | undefined;
}

/** Within this many px of the bottom the thread follows new rows (review I4). */
const STICK_PX = 48;
const NO_SESSIONS: readonly SessionLike[] = [];

function LiveCardChat({ city, card, title, peer, sessions }: LiveProps) {
  const chat = useCardChat(city, card, sessions ?? NO_SESSIONS);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  // review I4: open at the newest row; follow new rows unless the owner scrolled up
  useLayoutEffect(() => {
    const el = threadRef.current;
    if (el !== null && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.rows.length, chat.status]);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);
  const readOnly = useReadOnly();
  const id = useId();
  const [value, setValue] = useState('');

  if (chat.status === 'loading') return <ChatSkeleton />;
  if (chat.status === 'no_chat') return <NoChat />;

  const send = () => {
    const text = value.trim();
    if (text.length === 0) return;
    setValue(''); // owner 19.11 point 5: the box clears at once
    chat.send(text);
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  const line = agentLine(chat);

  return (
    <section data-testid="card-chat" aria-label={t('Card chat')} className="flex w-full min-w-0 flex-col gap-2">
      <div
        ref={threadRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
        }}
        data-testid="card-chat-thread"
        className="flex max-h-[35dvh] min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain md:max-h-[45dvh]"
      >
        {chat.status === 'error' && (
          <p role="alert" className="text-sm text-vk-error">
            {t('The chat could not be read.')}
          </p>
        )}
        {chat.rows.map((row) => (
          <div
            key={row.key}
            data-testid="chat-row"
            data-who={row.who}
            className={cn(
              'flex flex-col gap-1 border-l-2 pl-2',
              row.who === 'owner' ? 'border-vk-mine' : 'border-vk-peer',
            )}
          >
            <span className="text-sm font-medium text-vk-text-low">{whoName(row.who)}</span>
            {row.text.length > 0 && (
              <p
                className={cn(
                  'm-0 whitespace-pre-wrap text-base [overflow-wrap:anywhere]',
                  row.state === 'sending' || row.state === 'queued' || row.state === 'failed'
                    ? 'text-vk-text-low'
                    : 'text-vk-text-normal',
                )}
              >
                {row.text}
              </p>
            )}
            <RowState row={row} who={chat.who} onRetry={() => chat.retry(row.key)} />
            {row.ask !== undefined && !row.ask.answered && !readOnly && (
              <div className="flex gap-2">
                {[true, false].map((yes) => (
                  <button
                    key={yes ? 'yes' : 'no'}
                    type="button"
                    onClick={() => chat.answer(row.ask!.entryId, yes)}
                    className={cn(
                      'min-h-11 rounded-sm border border-vk-border px-4 text-base focus-mark md:min-h-8',
                      yes ? 'bg-vk-brand text-vk-on-brand' : 'bg-vk-bg-panel text-vk-text-high',
                    )}
                  >
                    {yes ? t('Yes') : t('No')}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {line !== null && <p className="text-sm font-light text-vk-text-low">{line}</p>}
      </div>
      {!readOnly && (
        <div
          data-testid="card-chat-input"
          className="flex flex-none flex-col gap-2 rounded-sm border border-vk-border bg-vk-bg-secondary p-2"
        >
          <label htmlFor={id} className="sr-only">
            {t('Ask about this card')}
          </label>
          <div className="flex items-end gap-2">
            <textarea
              id={id}
              rows={2}
              value={value}
              placeholder={t('Ask about this card…')}
              maxLength={CHAT_TEXT_MAX}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={onKey}
              className="min-h-[20px] min-w-0 flex-1 resize-none border-0 bg-transparent p-0 text-base text-vk-text-high outline-none placeholder:text-vk-text-low"
            />
            <button
              type="button"
              aria-label={t('Send')}
              onClick={send}
              disabled={value.trim().length === 0}
              className="flex size-11 shrink-0 items-center justify-center rounded-full border border-vk-border bg-vk-bg-panel text-vk-text-high transition-colors hover:bg-vk-bg-secondary focus-mark disabled:cursor-not-allowed disabled:opacity-50 md:size-[28px]"
            >
              <ArrowUpIcon size={12} weight="bold" />
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex flex-col text-[13px] text-vk-text-low">
              <span>{t('only you and your Mayor see it')}</span>
              {/* review M9: only the summary went; the chat stays private */}
              {shared && peer !== null && <span>{t('{name} sees only what you showed him', { name: peer.name })}</span>}
            </span>
            {value.length > 0 && (
              <span className="text-[13px] text-vk-text-low">
                {t('{n} of {max} characters', { n: value.length, max: CHAT_TEXT_MAX })}
              </span>
            )}
            {peer !== null && (
              <button
                type="button"
                onClick={() => setSharing(true)}
                className="min-h-11 rounded-sm px-1 text-sm text-vk-text-low underline underline-offset-2 focus-mark hover:text-vk-text-high md:min-h-0"
              >
                {shareLabel(peer)}
              </button>
            )}
          </div>
          {peer !== null && (
            <ShareDialog
              open={sharing}
              onClose={() => setSharing(false)}
              city={city}
              card={card}
              title={title}
              rows={chat.rows}
              peer={peer}
              onShared={() => {
                setSharing(false);
                setShared(true);
              }}
            />
          )}
        </div>
      )}
    </section>
  );
}
