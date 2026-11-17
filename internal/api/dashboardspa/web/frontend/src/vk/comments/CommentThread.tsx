/*
 * Portions of this file are adapted from vibe-kanban
 * (https://github.com/BloopAI/vibe-kanban, upstream commit 3f095f0186f6).
 *
 * Copyright BloopAI (vibe-kanban authors)
 *
 * vibe-kanban's LICENSE leaves its copyright line as the Apache template
 * placeholder ("Copyright [yyyy] [name of copyright owner]"); the holder above
 * is taken from its npx-cli/package.json "author" ("bloop") and its GitHub
 * organisation (BloopAI).
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified for the Gas City dashboard: one comment row reads our PeerComment
 * (cross-city comments and Mayor topics, vk-final part 4) instead of VK's
 * IssueCommentData; useTranslation → our `t`; the WYSIWYG editor, emoji
 * picker, edit/delete menu, attachments and dropzone are dropped (no
 * contract for them); added the author kinds (initials / Mayor glyph / robot
 * glyph with an «агент» chip), the two cities' side colours (2 px left rule
 * and avatar ring), grouping of consecutive comments by one author, the
 * delivery state on the owner's own comments and the «✓ принято» ack.
 */
// Source: vibe-kanban packages/ui/src/components/IssueCommentsSection.tsx (CommentItem, comment input)

import { ArrowUpIcon } from '@phosphor-icons/react';
import { useId, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { t } from '../../i18n';
import { withApiBase } from '../../lib/apiBase';
import { asOfClock } from '../../lib/boardOwner';
import type { CommentAuthor, PeerComment } from '../../supervisor/peerBoardReads';
import { activeMention, filterMentions, insertMention, type MentionOption } from './mentions';
import { cn } from '../cn';

const JUST_NOW_MS = 60_000;

export function MayorGlyph({ size = 10 }: { size?: number }) {
  return (
    <svg data-testid="glyph-mayor" width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function AgentGlyph({ size = 10 }: { size?: number }) {
  return (
    <svg data-testid="glyph-agent" width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 2.5V5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="6" cy="9" r="1" fill="currentColor" />
      <circle cx="10" cy="9" r="1" fill="currentColor" />
    </svg>
  );
}

export type Side = 'mine' | 'peer';

/**
 * The author's avatar in a side-colour ring. Fallback order (owner 15.11):
 * the Discord avatar image (same-origin, cached by our city service), else the
 * Mayor or robot glyph or the initials; the city's side rule stays either way.
 */
export function AuthorAvatar({ author, side }: { author: CommentAuthor; side: Side }) {
  const [broken, setBroken] = useState<string | null>(null);
  const image = author.avatarUrl !== null && broken !== author.avatarUrl ? author.avatarUrl : null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'box-border flex shrink-0 items-center justify-center overflow-hidden rounded-full border-[1.5px] bg-vk-bg-secondary text-[10px] font-medium text-vk-text-low',
        image !== null ? 'size-5' : 'size-4',
        side === 'mine' ? 'border-vk-mine' : 'border-vk-peer',
      )}
    >
      {image !== null ? (
        <img
          data-testid="avatar-image"
          src={withApiBase(image)}
          alt=""
          width={20}
          height={20}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(image)}
          className="size-full object-cover"
        />
      ) : author.kind === 'mayor' ? (
        <MayorGlyph />
      ) : author.kind === 'agent' ? (
        <AgentGlyph />
      ) : (
        <span data-testid="avatar-initials">{author.name.trim().charAt(0).toUpperCase()}</span>
      )}
    </span>
  );
}

export interface AuthorNames {
  /** «Ричарда» */
  peerLabel: string;
  /** «Артёма» when known; else «Мой Мэр». */
  myLabel?: string | undefined;
}

/**
 * The author's role (owner 15.11): «Мэр Ричарда» / «Мой Мэр» for a Mayor,
 * the person's name («Ричард»), or «агент · deputy» for another agent.
 */
export function authorRole(author: CommentAuthor, side: Side, names: AuthorNames): string {
  if (author.kind === 'agent') return t('agent · {name}', { name: author.agent ?? author.name });
  return authorName(author, side, names);
}

export function authorName(author: CommentAuthor, side: Side, names: AuthorNames): string {
  if (author.kind === 'mayor') {
    if (side === 'peer') return t('Mayor of {owner}', { owner: names.peerLabel });
    return names.myLabel !== undefined ? t('Mayor of {owner}', { owner: names.myLabel }) : t('My Mayor');
  }
  if (author.kind === 'agent') return author.agent ?? author.name;
  return author.name;
}

/**
 * The caption under a Discord display name (BOARD-LIVE L5): the city's
 * `role_caption` («Мэр Артёма»; built by OUR city from OUR people.json), else
 * the role worked out here. For a person the caption is the name, so it is
 * dropped when it repeats the display name (the name shows once).
 */
export function roleCaptionOf(author: CommentAuthor, side: Side, names: AuthorNames): string | null {
  const caption = author.kind === 'agent' ? authorRole(author, side, names) : (author.roleCaption ?? authorRole(author, side, names));
  const shown = author.displayName?.trim().toLocaleLowerCase() ?? '';
  return caption.trim().toLocaleLowerCase() === shown ? null : caption;
}

function AuthorIdentity({ displayName, caption }: { displayName: string; caption: string | null }) {
  return (
    <span className="flex min-w-0 flex-col leading-tight">
      <span className="font-medium text-vk-text-high [overflow-wrap:anywhere]">{displayName}</span>
      {caption !== null && (
        <span data-testid="role-caption" className="text-xs font-light text-vk-text-low">
          {caption}
        </span>
      )}
    </span>
  );
}

export function commentTime(iso: string, nowMs: number): string {
  const at = Date.parse(iso);
  if (Number.isFinite(at) && nowMs - at >= 0 && nowMs - at < JUST_NOW_MS) return t('just now');
  return asOfClock(iso);
}

function sameAuthor(a: PeerComment, b: PeerComment): boolean {
  return (
    a.mine === b.mine &&
    a.author.kind === b.author.kind &&
    a.author.name === b.author.name &&
    a.author.agent === b.author.agent
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 5v3.2l2 1.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** «доставлено ✓ / ждёт доставки / не доставлено»: only on the owner's own comments. */
function DeliveryState({ comment, peerName }: { comment: PeerComment; peerName: string | undefined }) {
  if (!comment.mine || comment.author.kind !== 'person' || comment.state === null) return null;
  if (comment.undelivered === 'peer_offline' && comment.state !== 'delivered') {
    // BOARD-LIVE C5: still in our outbox because the peer's Mac is offline
    return (
      <span className="text-sm font-light text-warn">
        {peerName !== undefined
          ? t('not delivered: {name} is offline', { name: peerName })
          : t('not delivered: the other city is offline')}
      </span>
    );
  }
  if (comment.state === 'delivered') {
    return (
      <span className="inline-flex items-center gap-[3px] text-sm font-light text-vk-success">
        {t('delivered')}
        <CheckIcon />
      </span>
    );
  }
  if (comment.state === 'rejected') {
    return (
      <span className="text-sm font-light text-vk-error" title={comment.reason ?? undefined}>
        {t('not delivered')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-[3px] text-sm font-light text-vk-text-low">
      <ClockIcon />
      {t('waiting for delivery')}
    </span>
  );
}

export interface CommentListProps extends AuthorNames {
  comments: readonly PeerComment[];
  nowMs: number;
  /** Message ids that carry an «ack» reaction. */
  acks?: ReadonlySet<string>;
  /** Message ids to mark «новое». */
  unread?: ReadonlySet<string>;
  /** Called with a comment's DOM node (topics: read stamps once a message is on screen). */
  itemRef?: (comment: PeerComment) => Ref<HTMLDivElement> | undefined;
  /** Extra line under a message (e.g. «спросил Артёма → ждёт ответа»). */
  noteOf?: (comment: PeerComment) => ReactNode;
  /** The peer person's name («Ричард»), for «не доставлено: Ричард не в сети». */
  peerName?: string;
}

/** The thread: VK CommentItem rows, grouped by consecutive author. */
export function CommentList({
  comments,
  nowMs,
  peerLabel,
  myLabel,
  acks,
  unread,
  itemRef,
  noteOf,
  peerName,
}: CommentListProps) {
  return (
    <div className="flex flex-col gap-2">
      {comments.map((comment, i) => {
        const side: Side = comment.mine ? 'mine' : 'peer';
        const prev = i > 0 ? comments[i - 1] : undefined;
        const grouped = prev !== undefined && sameAuthor(prev, comment);
        const agentish = comment.author.kind !== 'person';
        const ref = itemRef?.(comment);
        return (
          <div
            key={comment.id}
            id={`comment-${comment.id}`}
            data-testid="comment"
            data-side={side}
            data-comment-id={comment.id}
            ref={ref}
            className={cn(
              'flex flex-col gap-2 border-l-2 pl-2',
              side === 'mine' ? 'border-vk-mine' : 'border-vk-peer',
              grouped && '-mt-1',
            )}
          >
            {!grouped && (
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                <AuthorAvatar author={comment.author} side={side} />
                {comment.author.displayName !== null ? (
                  // Discord identity: the display name, the role caption under it
                  <AuthorIdentity
                    displayName={comment.author.displayName}
                    caption={roleCaptionOf(comment.author, side, { peerLabel, myLabel })}
                  />
                ) : (
                  <span className="font-medium text-vk-text-low">
                    {authorName(comment.author, side, { peerLabel, myLabel })}
                  </span>
                )}
                {agentish && comment.author.displayName === null && (
                  <span className="inline-flex h-[18px] items-center rounded-sm bg-vk-bg-panel px-[5px] text-xs text-vk-text-low">
                    {t('agent')}
                  </span>
                )}
                <span className="font-medium text-vk-text-low">·</span>
                <span className="font-light text-vk-text-low">{commentTime(comment.createdAt, nowMs)}</span>
                {comment.mine && comment.author.kind === 'person' && comment.state !== null && (
                  <>
                    <span className="font-medium text-vk-text-low">·</span>
                    <DeliveryState comment={comment} peerName={peerName} />
                  </>
                )}
                {unread?.has(comment.id) && (
                  <span className="inline-flex h-[18px] items-center rounded-full bg-vk-brand-secondary px-1.5 text-[11px] font-semibold text-vk-on-brand">
                    {t('new')}
                  </span>
                )}
              </div>
            )}
            {grouped && comment.mine && comment.author.kind === 'person' && comment.state !== null && (
              <div className="text-sm">
                <DeliveryState comment={comment} peerName={peerName} />
              </div>
            )}
            <p
              className={cn(
                'm-0 whitespace-pre-wrap text-base [overflow-wrap:anywhere]',
                comment.mine && comment.state === 'queued' ? 'text-vk-text-low' : 'text-vk-text-normal',
              )}
            >
              {comment.text}
            </p>
            {noteOf?.(comment)}
            {acks?.has(comment.id) && (
              <span className="inline-flex h-6 items-center self-start rounded-sm border border-vk-border bg-vk-bg-secondary px-2 text-xs text-vk-text-low">
                {t('✓ acknowledged')}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export interface CommentComposerProps {
  /** The textarea's accessible name. */
  label: string;
  placeholder: string;
  /** The low line under the box («уйдёт в город Ричарда за ~минуту…»). */
  hint?: string;
  onSubmit: (text: string) => Promise<void>;
  /** Turns a failure into the line under the box. */
  errorText?: (err: unknown) => string;
  className?: string;
  textareaRef?: Ref<HTMLTextAreaElement>;
  /** Nothing can be sent yet (e.g. no recipient chosen). */
  disabled?: boolean;
  /** Owner 17.11: `@` suggests these tokens (./mentions); absent = no list. */
  mentions?: readonly MentionOption[];
}

/** The VK comment box: textarea, hint and the round send button; Ctrl/⌘+Enter sends. */
export function CommentComposer({
  label,
  placeholder,
  hint,
  onSubmit,
  errorText,
  className,
  textareaRef,
  disabled = false,
  mentions,
}: CommentComposerProps) {
  const id = useId();
  const listId = useId();
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const empty = value.trim().length === 0 || disabled;
  // owner 17.11: the `@word` under the caret and the matching suggestions
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const mention = mentions ? activeMention(value, caret) : null;
  const shown = mention && mention.start !== closedAt ? filterMentions(mentions ?? [], mention.query) : [];
  const highlighted = Math.min(pick, Math.max(shown.length - 1, 0));

  const edit = (next: string, at: number) => {
    setValue(next);
    setCaret(at);
    setPick(0);
  };

  const choose = (option: MentionOption) => {
    if (!mention) return;
    const next = insertMention(value, mention.start, caret, option.token);
    edit(next.value, next.caret);
    setClosedAt(null);
    const area = document.getElementById(id) as HTMLTextAreaElement | null;
    if (area) {
      area.focus();
      requestAnimationFrame(() => area.setSelectionRange(next.caret, next.caret));
    }
  };

  const send = async () => {
    if (empty || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSubmit(value.trim());
      setValue('');
    } catch (err) {
      setError(errorText ? errorText(err) : t('Not sent — try again.'));
    } finally {
      setSending(false);
    }
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (shown.length > 0 && mention) {
      const plain = !event.metaKey && !event.ctrlKey;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setPick((highlighted + (event.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length);
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && plain) {
        event.preventDefault();
        choose(shown[highlighted]!);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setClosedAt(mention.start);
        return;
      }
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div
      className={cn(
        'relative flex flex-col gap-3 rounded-sm border border-vk-border bg-vk-bg-secondary p-3 font-vk-sans',
        className,
      )}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {shown.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('Mention')}
          className="absolute bottom-full left-0 z-10 mb-1 flex max-w-full flex-col rounded-sm border border-vk-border bg-vk-bg-panel py-1 text-sm shadow"
        >
          {shown.map((o, i) => (
            <li
              key={o.token}
              role="option"
              aria-selected={i === highlighted}
              onMouseDown={(e) => {
                e.preventDefault(); // keep the caret in the box
                choose(o);
              }}
              className={cn(
                'flex min-h-11 cursor-pointer items-center gap-2 px-3 md:min-h-0 md:py-1',
                i === highlighted && 'bg-vk-bg-secondary',
              )}
            >
              <span className="text-vk-text-high">@{o.token}</span>
              <span className="text-vk-text-low">{o.caption}</span>
            </li>
          ))}
        </ul>
      )}
      <textarea
        id={id}
        ref={textareaRef}
        rows={2}
        value={value}
        placeholder={placeholder}
        onChange={(e) => edit(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={onKey}
        {...(mentions ? { 'aria-autocomplete': 'list' as const } : {})}
        {...(shown.length > 0 ? { 'aria-controls': listId } : {})}
        className="min-h-[20px] resize-none border-0 bg-transparent p-0 text-base text-vk-text-high outline-none placeholder:text-vk-text-low"
      />
      {error !== null && (
        <p role="alert" className="text-sm text-vk-error">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-vk-text-low">{hint}</span>
        <button
          type="button"
          aria-label={t('Send')}
          onClick={() => void send()}
          disabled={empty || sending}
          className="flex size-11 shrink-0 items-center justify-center rounded-full border border-vk-border bg-vk-bg-panel text-vk-text-high transition-colors hover:bg-vk-bg-secondary focus-mark disabled:cursor-not-allowed disabled:opacity-50 md:size-[28px]"
        >
          <ArrowUpIcon size={12} weight="bold" />
        </button>
      </div>
    </div>
  );
}
