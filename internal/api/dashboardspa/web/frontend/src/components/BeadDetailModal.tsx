import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { resolveSessionForTarget } from 'gas-city-dashboard-shared';
import type { BeadNode } from '../lib/beadGraph';
import { useBeadDetail } from '../hooks/useBeadDetail';
import { useBoardData } from '../hooks/useBoardData';
import { useEntityLinks } from '../hooks/useEntityLinks';
import { t } from '../i18n';
import { MARKDOWN_CLASS, renderMiniMarkdown } from '../lib/miniMarkdown';
import { ownerQuestionOf } from '../lib/ownerQuestions';
import { milestoneOf } from '../lib/waitReasons';
import type { SupervisorBead } from '../supervisor/beadReads';
import type { SupervisorSession } from '../supervisor/sessionReads';
import { DiscussButton } from '../vk/DiscussButton';
import { AgentWork } from '../vk/panel/AgentWork';
import { blockerTags, Relationships } from '../vk/panel/Relationships';
import {
  DotChip,
  MayorMessageBox,
  QuestionCard,
  QuestionHistory,
  StatusRow,
  TaskDrawer,
  taskSummary,
  type Answer,
} from '../vk/panel/TaskDrawer';
import { taskKind, taskPr, taskShortLabel } from '../vk/panel/drawerFacts';
import { tagColor } from '../vk/board/KanbanCard';
import { ExternalLink } from '../vk/ExternalLink';
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

  const pr = useMemo(() => (bead ? taskPr(bead, items) : null), [bead, items]);
  const label = bead ? taskShortLabel(bead) : (beadId ?? '');
  // vk-1to1 canvas: «M04 #3 / PR #580» (short label, never the raw id).
  const crumb = (
    <>
      <span className="shrink-0" title={bead?.id ?? beadId ?? undefined}>
        {label}
      </span>
      {pr !== null && (
        <>
          <span className="text-vk-text-low">/</span>
          <span className="truncate">{t('PR #{n}', { n: pr.number })}</span>
        </>
      )}
    </>
  );
  const recipe = bead?.metadata?.['gc.kind'] === 'run';
  const needsYou = question !== null && answer === null;
  const stage = bead ? stageChip(bead) : null;
  const hasChips = milestone !== null || stage !== null || needsYou || pr !== null || recipe;
  const chips = bead && hasChips ? (
    <>
      {milestone !== null && <DotChip color={tagColor(milestone)}>{milestone}</DotChip>}
      {stage !== null && <DotChip color="#64748B">{stage}</DotChip>}
      {needsYou && (
        <span className="inline-flex h-5 items-center rounded-sm bg-vk-brand/15 px-2 text-sm font-medium text-vk-text-high">
          {t('needs you')}
        </span>
      )}
      {pr !== null &&
        (pr.url !== null ? (
          <ExternalLink href={pr.url} className="px-0.5 font-vk-mono text-[13px] text-vk-text-low hover:text-vk-text-high">
            #{pr.number}
          </ExternalLink>
        ) : (
          <span className="px-0.5 font-vk-mono text-[13px] text-vk-text-low">#{pr.number}</span>
        ))}
      {recipe && (
        <span className="text-sm font-medium text-warn">{t('A formula recipe, not work: do not close it')}</span>
      )}
    </>
  ) : null;

  // ONE «Обсудить с Мэром» (canvas quiet secondary link under the title);
  // the caller's write actions sit next to it.
  const actions =
    bead && discussCtx ? (
      <>
        <DiscussButton ctx={discussCtx} label={t('Discuss with the Mayor')} variant="secondary" />
        {renderActions?.(bead)}
      </>
    ) : undefined;

  return (
    <>
      <TaskDrawer
        open={open}
        onClose={onClose}
        crumb={crumb}
        statusRow={
          bead ? (
            <StatusRow
              status={bead.status}
              assignee={bead.assignee ?? null}
              kind={taskKind(bead)}
              tag={milestone}
            />
          ) : undefined
        }
        chips={chips}
        title={bead?.title ?? beadId ?? t('Task')}
        description={
          bead?.description && bead.description.length > 0 ? (
            <div
              data-testid="task-description"
              className={`text-base text-vk-text-normal ${MARKDOWN_CLASS}`}
            >
              {renderMiniMarkdown(bead.description, { headingFrom: 3 })}
            </div>
          ) : undefined
        }
        top={
          question !== null && answer === null && discussCtx ? (
            <QuestionCard q={question} onAnswered={setAnswer} />
          ) : undefined
        }
        actions={actions}
        footer={footer ?? (discussCtx ? <MayorMessageBox ctx={discussCtx} /> : null)}
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
              pr={pr}
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

/** Canvas «Пакет этапа»: the stage-package chip when the task is a stage bead. */
function stageChip(bead: SupervisorBead): string | null {
  const kind = bead.metadata?.['devwork.kind']?.trim() ?? '';
  if (kind === 'stage' || kind === 'stage_package' || (bead.labels ?? []).includes('kind:stage')) {
    return t('Stage package');
  }
  return null;
}
