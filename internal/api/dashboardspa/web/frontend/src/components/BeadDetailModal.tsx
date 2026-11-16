import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { resolveSessionForTarget } from 'gas-city-dashboard-shared';
import type { BeadNode } from '../lib/beadGraph';
import { useBeadDetail } from '../hooks/useBeadDetail';
import { useBoardData } from '../hooks/useBoardData';
import { useEntityLinks } from '../hooks/useEntityLinks';
import { getLocale, t } from '../i18n';
import { MARKDOWN_CLASS, renderMiniMarkdown } from '../lib/miniMarkdown';
import { ownerQuestionOf } from '../lib/ownerQuestions';
import { milestoneOf } from '../lib/waitReasons';
import type { SupervisorBead } from '../supervisor/beadReads';
import type { SupervisorSession } from '../supervisor/sessionReads';
import { DiscussButton } from '../vk/DiscussButton';
import { AgentWork } from '../vk/panel/AgentWork';
import { blockerTags, Relationships } from '../vk/panel/Relationships';
import {
  Chip,
  QuestionCard,
  QuestionHistory,
  statusLabel,
  TaskDrawer,
  taskSummary,
  type Answer,
} from '../vk/panel/TaskDrawer';
import { BeadLiveRunModal } from './beads/BeadLiveRunModal';
import { isSessionStreamable } from './LiveSessionPeek';
import { otherLinkCount, RelatedEntities } from './RelatedEntities';

// Click-to-read task panel for a single bead (vk lane 2): a right-side VK
// drawer from `md`, a full-screen card below. The export name and props are
// unchanged, so the Beads board, AgentDetail and other callers stay as they
// are.
//
// Fetches direct supervisor bead detail on open. If the caller already has
// the full bead in state (Beads, AgentDetail), it can pass it via
// `initialBead` so the panel renders immediately and skips the network round
// trip.

const EMPTY_ITEMS: readonly SupervisorBead[] = [];

interface BeadDetailModalProps {
  open: boolean;
  onClose: () => void;
  beadId: string | null;
  /** Optional pre-loaded bead. When present and complete, skips the fetch. */
  initialBead?: SupervisorBead | null;
  /**
   * Re-center the panel on a related bead (gascity-dashboard-j4x). When
   * omitted, related bead rows render as plain text (no in-place
   * navigation) so the panel can be used standalone.
   */
  onOpenBead?: (beadId: string) => void;
  /** Kept for callers; unused since polish2 (one «Связи» section). */
  depNode?: BeadNode | null;
  /** Session list for assignee to live-run resolution; enables "View live run". */
  sessions?: readonly SupervisorSession[];
  /** Optional caller-owned action slot, used by Beads for direct supervisor writes. */
  renderActions?: (bead: SupervisorBead) => ReactNode;
  /** Extra section under the agents' work (vk-final: the card's conversation thread). */
  extra?: ReactNode;
  /** Pinned at the drawer's bottom (vk-final: the card's comment box). */
  footer?: ReactNode;
}

export function BeadDetailModal({
  open,
  onClose,
  beadId,
  initialBead = null,
  onOpenBead,
  // polish2 item 8: relations live in «Связи»; the dependency tree is gone.
  depNode: _depNode = null,
  sessions,
  renderActions,
  extra = null,
  footer = null,
}: BeadDetailModalProps) {
  const { bead, loading, error, notFound, now } = useBeadDetail(open, beadId, initialBead);
  const links = useEntityLinks(open ? beadId : null);
  const board = useBoardData();
  const items = board.data?.items ?? EMPTY_ITEMS;
  const [runOpen, setRunOpen] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);

  // An answer belongs to one bead; re-centring on another clears it.
  useEffect(() => setAnswer(null), [beadId]);

  const session =
    bead && sessions && bead.assignee && bead.assignee.length > 0
      ? resolveSessionForTarget(bead.assignee, sessions)
      : null;
  const liveRunnable = isSessionStreamable(session);
  const question = useMemo(() => (bead ? ownerQuestionOf(bead) : null), [bead]);
  const discussCtx = useMemo(
    () =>
      bead
        ? {
            kind: 'task' as const,
            beadId: bead.id,
            title: bead.title,
            summary: taskSummary(bead, blockerTags(bead, items)),
          }
        : null,
    [bead, items],
  );
  const milestone = bead ? milestoneOf(bead) : null;

  const idTag = (id: string) => (
    <code className="font-vk-mono text-sm text-vk-text-low [overflow-wrap:anywhere]">{id}</code>
  );
  const chips = bead ? <>{idTag(bead.id)}</> : beadId ? idTag(beadId) : null;

  const actions =
    bead && discussCtx ? (
      <>
        <DiscussButton ctx={discussCtx} label={t('Discuss with the Mayor')} />
        {renderActions?.(bead)}
      </>
    ) : undefined;

  return (
    <>
      <TaskDrawer
        open={open}
        onClose={onClose}
        chips={chips}
        title={bead?.title ?? beadId ?? t('Task')}
        meta={
          bead ? (
            <TaskMeta
              bead={bead}
              milestone={milestone}
              needsYou={question !== null && answer === null}
            />
          ) : undefined
        }
        top={
          question !== null && answer === null && discussCtx ? (
            <QuestionCard q={question} onAnswered={setAnswer} />
          ) : undefined
        }
        actions={actions}
        footer={footer}
      >
        {notFound ? (
          <div className="space-y-2">
            <p className="text-vk-text-low">{t('This decision was resolved or removed.')}</p>
            <p className="text-sm text-vk-text-low">
              {t(
                'The task it pointed to is no longer in the supervisor — it was likely closed or pruned since this link was surfaced.',
              )}
            </p>
          </div>
        ) : error ? (
          <p className="text-accent" role="alert">
            {error}
          </p>
        ) : loading && bead === null ? (
          <p className="text-sm text-vk-text-low">{t('Fetching the task.')}</p>
        ) : bead === null ? (
          <p className="text-sm text-vk-text-low">{t('No task.')}</p>
        ) : (
          <>
            {bead.description && bead.description.length > 0 && (
              <div
                data-testid="task-description"
                className={`text-[15px] text-vk-text-normal ${MARKDOWN_CLASS}`}
              >
                {renderMiniMarkdown(bead.description, { headingFrom: 3 })}
              </div>
            )}
            <Relationships
              bead={bead}
              items={items}
              hasOtherLinks={otherLinkCount(links.view) > 0 || links.error !== null}
              {...(onOpenBead !== undefined ? { onOpenBead } : {})}
            >
              <RelatedEntities
                embedded
                view={links.view}
                loading={links.loading}
                error={links.error}
                now={now}
                {...(onOpenBead !== undefined ? { onOpenBead } : {})}
              />
            </Relationships>
            <AgentWork
              bead={bead}
              sessions={board.sessions}
              {...(liveRunnable ? { onWatch: () => setRunOpen(true) } : {})}
            />
            {extra}
            {question !== null && answer !== null && (
              <QuestionHistory q={question} answer={answer} />
            )}
          </>
        )}
      </TaskDrawer>

      {bead && (
        <BeadLiveRunModal
          open={runOpen}
          onClose={() => setRunOpen(false)}
          session={session}
          beadTitle={bead.title}
        />
      )}
    </>
  );
}

/** Labels the meta line already says another way (the stage chip, «нужен ты»). */
const SHOWN_ELSEWHERE = /^(milestone:|needs\/operator$)/;

function createdText(iso: string | undefined): string | null {
  if (iso === undefined) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const sameYear = at.getFullYear() === new Date().getFullYear();
  const date = new Intl.DateTimeFormat(getLocale() === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(at);
  return t('created {date}', { date });
}

/**
 * polish2 16.11 (owner, item 8): the card's facts in ONE line under the title
 * (status, stage, executor, created, labels). It replaces «Подробности».
 */
function TaskMeta({
  bead,
  milestone,
  needsYou,
}: {
  bead: SupervisorBead;
  milestone: string | null;
  needsYou: boolean;
}) {
  const recipe = bead.metadata?.['gc.kind'] === 'run';
  const created = createdText(bead.created_at);
  const labels = (bead.labels ?? []).filter((l) => !SHOWN_ELSEWHERE.test(l));
  const assignee = bead.assignee && bead.assignee.length > 0 ? bead.assignee : t('nobody');
  return (
    <div
      data-testid="task-meta"
      className="-mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-vk-text-low"
    >
      {needsYou && <Chip tone="brand">{t('needs you')}</Chip>}
      <Chip>{statusLabel(bead.status)}</Chip>
      {milestone !== null && <Chip>{milestone}</Chip>}
      {recipe && (
        <span className="font-medium text-warn">
          {t('A formula recipe, not work: do not close it')}
        </span>
      )}
      <span className="[overflow-wrap:anywhere]">{t('Executor: {who}', { who: assignee })}</span>
      {created !== null && <span className="tnum">{created}</span>}
      {labels.map((label) => (
        <span
          key={label}
          className="inline-flex max-w-full rounded-full bg-vk-bg-panel px-2 py-0.5 text-[13px] text-vk-text-normal [overflow-wrap:anywhere]"
        >
          {label}
        </span>
      ))}
    </div>
  );
}
