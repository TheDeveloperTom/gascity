import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { resolveSessionForTarget } from 'gas-city-dashboard-shared';
import type { BeadNode } from '../lib/beadGraph';
import { useBeadDetail } from '../hooks/useBeadDetail';
import { useBoardData } from '../hooks/useBoardData';
import { useEntityLinks } from '../hooks/useEntityLinks';
import { t } from '../i18n';
import { renderMiniMarkdown } from '../lib/miniMarkdown';
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
import { BeadBody } from './BeadBody';
import { BeadDependencies } from './beads/BeadDependencies';
import { BeadLiveRunModal } from './beads/BeadLiveRunModal';
import { Button } from './Button';
import { isSessionStreamable } from './LiveSessionPeek';
import { RelatedEntities } from './RelatedEntities';

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
  /** Resolved graph node for the bead; when present, shows the dependency tree. */
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
  depNode = null,
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
  const chips = bead ? (
    <>
      <Chip>{statusLabel(bead.status)}</Chip>
      {milestone !== null && <Chip>{milestone}</Chip>}
      {question !== null && answer === null && <Chip tone="brand">{t('needs you')}</Chip>}
      {idTag(bead.id)}
    </>
  ) : beadId ? (
    idTag(beadId)
  ) : null;

  const actions =
    bead && discussCtx ? (
      <>
        <DiscussButton ctx={discussCtx} label={t('Discuss with the Mayor')} className="md:w-auto" />
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
        top={
          question !== null && answer === null && discussCtx ? (
            <QuestionCard q={question} discussCtx={discussCtx} onAnswered={setAnswer} />
          ) : undefined
        }
        actions={actions}
        footer={footer}
      >
        {notFound ? (
          <div className="space-y-2">
            <p className="text-vk-text-low">This decision was resolved or removed.</p>
            <p className="text-sm text-vk-text-low">
              The bead it pointed to is no longer in the supervisor — it was likely closed or pruned
              since this link was surfaced.
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
              <div className="text-[15px] text-vk-text-normal [overflow-wrap:anywhere]">
                {renderMiniMarkdown(bead.description)}
              </div>
            )}
            <Relationships
              bead={bead}
              items={items}
              {...(onOpenBead !== undefined ? { onOpenBead } : {})}
            />
            <AgentWork
              bead={bead}
              sessions={board.sessions}
              {...(liveRunnable ? { onWatch: () => setRunOpen(true) } : {})}
            />
            {extra}
            {question !== null && answer !== null && (
              <QuestionHistory q={question} answer={answer} />
            )}
            <details className="text-sm">
              <summary className="flex min-h-[44px] cursor-pointer items-center text-vk-text-low">
                {t('Details')}
              </summary>
              <div className="space-y-6 pt-2">
                <BeadBody bead={bead} />
                {depNode && (
                  <BeadDependencies
                    node={depNode}
                    {...(onOpenBead !== undefined ? { onOpenBead } : {})}
                  />
                )}
                <RelatedEntities
                  view={links.view}
                  loading={links.loading}
                  error={links.error}
                  now={now}
                  {...(onOpenBead !== undefined ? { onOpenBead } : {})}
                />
                {liveRunnable && (
                  <Button size="sm" tone="quiet" onClick={() => setRunOpen(true)}>
                    View live run
                  </Button>
                )}
              </div>
            </details>
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
