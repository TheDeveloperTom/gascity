import { useMemo, useState } from 'react';
import { canWrite } from '../../embed/activitySession';
import { refreshPeerBoards } from '../../hooks/usePeerBoards';
import { t } from '../../i18n';
import type { PeerBoardSource } from '../../lib/boardOwner';
import type { PeerComment, PeerThread } from '../../supervisor/peerBoardReads';
import { commentErrorText, postCardComment } from '../../supervisor/peerCommentWrites';
import { AgentGlyph, CommentComposer, CommentList, MayorGlyph } from './CommentThread';

// vk-final part 4 (design Peer-Card / Phone-Peer-Card, redrawn 15.11): the
// «Комментарии» thread on a peer's card, and the «Написать Ричарду…» box
// pinned at the bottom of the panel while the thread scrolls above it. A
// sent comment shows at once as «ждёт доставки» until the next read carries
// it; delivery flips it to «доставлено ✓».

export interface PeerCommentsProps {
  peer: PeerBoardSource;
  rig: string;
  cardId: string;
  thread: PeerThread | undefined;
  nowMs: number;
}

const NONE: readonly PeerComment[] = [];

export function PeerComments({ peer, rig, cardId, thread, nowMs }: PeerCommentsProps) {
  const [pending, setPending] = useState<readonly PeerComment[]>(NONE);
  const served = thread?.comments ?? NONE;
  const comments = useMemo(() => {
    const ids = new Set(served.map((c) => c.id));
    return [...served, ...pending.filter((c) => !ids.has(c.id))];
  }, [served, pending]);
  const myName = served.find((c) => c.mine && c.author.kind === 'person')?.author.name ?? t('You');
  const writable = canWrite();

  const submit = async (text: string) => {
    const queued = await postCardComment({ city: peer.login, rig, id: cardId }, text);
    setPending((prev) => [
      ...prev,
      {
        id: queued.id,
        mine: true,
        author: { kind: 'person', city: null, name: myName, agent: null },
        text: queued.text,
        summary: null,
        createdAt: queued.createdAt,
        state: 'queued',
        reason: null,
        reopened: false,
      },
    ]);
    void refreshPeerBoards();
  };

  return (
    <section aria-labelledby="peer-comments-title" className="flex flex-col border-t border-vk-border">
      <h3 id="peer-comments-title" className="flex items-center gap-1.5 py-1 text-base font-medium text-vk-text-normal">
        {t('Comments')}
        {comments.length > 0 && <span className="font-normal text-vk-text-low">{comments.length}</span>}
      </h3>
      <div className="flex flex-wrap gap-3 pb-2 text-[13px] text-vk-text-low">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3.5 w-0.5 bg-vk-mine" />
          {t('your city')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3.5 w-0.5 bg-vk-peer" />
          {t('{owner} city', { owner: peer.label })}
        </span>
        <span className="inline-flex items-center gap-1">
          <MayorGlyph size={13} />
          {t('Mayor')}
        </span>
        <span className="inline-flex items-center gap-1">
          <AgentGlyph size={13} />
          {t('another agent')}
        </span>
      </div>
      <div className="flex flex-col gap-2 border-t border-vk-border py-2">
        {comments.length === 0 ? (
          <p className="text-sm text-vk-text-low">{t('No comments yet.')}</p>
        ) : (
          <CommentList comments={comments} nowMs={nowMs} peerLabel={peer.label} />
        )}
      </div>
      {writable && (
        <div
          data-testid="peer-composer"
          className="sticky bottom-0 -mx-4 border-t border-vk-border bg-vk-bg-primary px-4 pb-2 pt-2"
          style={{ paddingBottom: 'calc(0.5rem + var(--saib, env(safe-area-inset-bottom)))' }}
        >
          <CommentComposer
            label={t('Comment for {owner}', { owner: peer.label })}
            placeholder={
              peer.dative !== null
                ? t('Write to {name}…', { name: peer.dative })
                : t('Write to {owner} city…', { owner: peer.label })
            }
            hint={t('goes to {owner} city in about a minute; their Mayor will show it', { owner: peer.label })}
            onSubmit={submit}
            errorText={commentErrorText}
          />
        </div>
      )}
    </section>
  );
}

/** Count for a peer card's «💬 N». */
export function threadSize(thread: PeerThread | undefined): number {
  return thread?.comments.length ?? 0;
}
