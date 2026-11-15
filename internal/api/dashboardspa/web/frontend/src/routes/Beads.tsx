import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { GC_EVENT_PREFIX } from 'gas-city-dashboard-shared';
import { formatApiError } from '../api/client';
import { getActiveCity } from '../api/cityBase';
import { t, tn } from '../i18n';
import { useAttentionModel } from '../attention/context';
import { inProgressCardNote } from '../attention/beadsNeedingAttention';
import { resourceAttentionSeverity } from '../attention/routeHighlight';
import { BeadBoard } from '../components/beads/BeadBoard';
import { BoardFilterBar } from '../components/beads/BoardFilterBar';
import { IdleNotice } from '../components/beads/IdleNotice';
import { useBoardSources, type OwnerFilter } from '../lib/boardOwner';
import { mayorChannelUrl } from '../lib/discussWithMayor';
import {
  ALL_EPICS,
  epicSummaries,
  milestoneRangeLabel,
  plannedEmptyMilestones,
} from '../lib/epics';
import { BeadDetailModal } from '../components/BeadDetailModal';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { PageAlerts } from '../components/PageAlerts';
import { PageHeader } from '../components/PageHeader';
import { useNow } from '../contexts/NowContext';
import { READ_ONLY_CONTROL_TITLE, ReadOnlyBadge, useReadOnly } from '../contexts/ReadOnlyContext';
import { buildBeadGraph } from '../lib/beadGraph';
import { ALL_PROJECTS, buildBoardModel } from '../lib/boardModel';
import {
  BOARD_RECENT_CLOSED_LIMIT,
  BOARD_REFRESH_COALESCE_MS,
  boardDataOf,
  rigsCacheKey,
  sessionsCacheKey,
  sharedRead,
  useBoardData,
} from '../hooks/useBoardData';
import { useCachedData } from '../hooks/useCachedData';
import { useGcEventRefresh } from '../hooks/useGcEvents';
import { listSupervisorBeads, type SupervisorBead } from '../supervisor/beadReads';
import { listSupervisorRigs } from '../supervisor/rigReads';
import { closeSupervisorBead } from '../supervisor/beadWrites';
import { listSupervisorSessions } from '../supervisor/sessionReads';

// The Beads page (OWNER-HOME-PLAN B7): one board for every project, in the
// owner's words. The route line carries the counts (RB12), so there is no
// synopsis, scope label, status chips or rig select. The project and test
// filters are client-side and never remembered.
// vk integration: «Новая задача» is the filter bar's one button (it opens the
// Mayor's Discord channel); the old header create-and-sling form is gone.
// `?epic=<key>` (⌘K epic rows) preselects the epic filter.

// The board's refresh is a full list refetch (~1.3MB on a busy city); its
// coalesce window and closed window live with the shared read
// (hooks/useBoardData: BOARD_REFRESH_COALESCE_MS, BOARD_RECENT_CLOSED_LIMIT).
const EMPTY_BEADS: readonly SupervisorBead[] = [];

interface ActionMessage {
  tone: 'ok' | 'error';
  text: string;
}

export function BeadsPage() {
  const attention = useAttentionModel();
  const readOnly = useReadOnly();
  const cityName = getActiveCity();
  const cityCacheKey = cityName ?? 'no-city';
  const [searchParams] = useSearchParams();
  const selectedBeadParam = normalizeSelectedBeadParam(searchParams.get('bead'));
  // «Вся история» widens the fetch to closed beads (the old `closed` chip's
  // data effect). It drives BOTH the fetch (includeClosed) and the cache key.
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [project, setProject] = useState<string>(ALL_PROJECTS);
  const [search, setSearch] = useState('');
  const [showTests, setShowTests] = useState(false);
  const epicParam = normalizeSelectedBeadParam(searchParams.get('epic'));
  const [epic, setEpic] = useState<string>(epicParam ?? ALL_EPICS);
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all');
  const boardSources = useBoardSources();
  const [selectedId, setSelectedId] = useState<string | null>(selectedBeadParam);
  const [closing, setClosing] = useState<SupervisorBead | null>(null);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<ActionMessage | null>(null);

  // Dashboard v3: the open board is the one shared read (useBoardData), so
  // Главная and «Задачи» count from the same window. «Вся история» keeps its
  // own wider read; while it is off, that read stays idle.
  const board = useBoardData();
  const history = useCachedData(
    `beads:board:${cityCacheKey}:${showAllHistory ? 'all' : 'history-off'}`,
    () =>
      showAllHistory
        ? listSupervisorBeads({
            includeClosed: true,
            withRoutes: true,
            recentClosed: { limit: BOARD_RECENT_CLOSED_LIMIT },
          })
        : Promise.resolve(null),
  );
  const historyData = useMemo(() => boardDataOf(history.data), [history.data]);
  const data = showAllHistory ? historyData : board.data;
  const loading = showAllHistory ? history.loading : board.loading;
  const error = showAllHistory ? history.error : board.error;
  const refreshHistory = history.refresh;
  const refreshBoard = board.refresh;
  const refresh = showAllHistory ? refreshHistory : refreshBoard;
  // Leaving «Вся история» reads the open board afresh, so the view it returns
  // to is current rather than the window from before the history was opened.
  const wasHistory = useRef(showAllHistory);
  useEffect(() => {
    if (wasHistory.current && !showAllHistory) void refreshBoard();
    wasHistory.current = showAllHistory;
  }, [showAllHistory, refreshBoard]);
  // Rows are tasks only; route roots and steps travel beside them and fold
  // into their task's card, and service beads only name blockers (B2).
  const rows = useMemo(() => data?.items ?? EMPTY_BEADS, [data]);
  const routeBeads = useMemo(() => data?.routeItems ?? EMPTY_BEADS, [data]);
  const serviceItems = useMemo(() => data?.serviceItems ?? EMPTY_BEADS, [data]);
  // A truncated window may hide a live run, so only a complete one lets the
  // board read "no live run" as "its run stopped" (review I6).
  const routesComplete = data?.routesComplete ?? false;
  const upstreamTotal = data?.upstreamTotal;
  const upstreamFetched = data?.upstreamFetched;
  const hasLoadedBoard = data !== undefined;

  // Same cache keys and one shared request as useBoardData; read here for
  // the full rig records (paths) and the sessions' partial flag.
  const sessionsKey = sessionsCacheKey(cityName);
  const sessions = useCachedData(sessionsKey, () =>
    sharedRead(sessionsKey, listSupervisorSessions),
  );
  const sessionItems = useMemo(() => sessions.data?.items ?? [], [sessions.data]);
  const rigsKey = rigsCacheKey(cityName);
  const rigs = useCachedData(rigsKey, () => sharedRead(rigsKey, listSupervisorRigs));
  const rigItems = useMemo(() => rigs.data?.items ?? [], [rigs.data]);

  // useBoardData refreshes the open board on bead events; the history read
  // refreshes here, only while it is shown.
  useGcEventRefresh(
    [GC_EVENT_PREFIX.bead],
    () => {
      if (showAllHistory) void refreshHistory();
    },
    { coalesceMs: BOARD_REFRESH_COALESCE_MS },
  );

  useEffect(() => {
    if (selectedBeadParam !== null) setSelectedId(selectedBeadParam);
  }, [selectedBeadParam]);

  useEffect(() => {
    if (epicParam !== null) setEpic(epicParam);
  }, [epicParam]);

  const runClose = useCallback(
    async (bead: SupervisorBead) => {
      // Defense-in-depth: the disabled buttons already block this, but a
      // keyboard/programmatic path must never reach a write the server 405s.
      if (readOnly) return;
      setActionInFlight(bead.id);
      setActionMessage(null);
      try {
        await closeSupervisorBead(bead.id);
        setClosing(null);
        setActionMessage({ tone: 'ok', text: t('Closed {id}.', { id: bead.id }) });
        await refresh();
      } catch (err) {
        setActionMessage({ tone: 'error', text: formatApiError(err, t('close failed')) });
      } finally {
        setActionInFlight(null);
      }
    },
    [readOnly, refresh],
  );

  // One board model for every project (B4); filters never refetch.
  const boardModel = useMemo(
    () =>
      buildBoardModel(
        { items: rows, routeItems: routeBeads, serviceItems, routesComplete },
        rigItems,
        {
          project,
          search,
          showTests,
          epic,
          owner: ownerFilter,
        },
      ),
    [
      rows,
      routeBeads,
      serviceItems,
      routesComplete,
      rigItems,
      project,
      search,
      showTests,
      epic,
      ownerFilter,
    ],
  );
  const epics = useMemo(
    () => epicSummaries(rows, { closedCapped: !showAllHistory }),
    [rows, showAllHistory],
  );
  const plannedEmpty = useMemo(() => milestoneRangeLabel(plannedEmptyMilestones(rows)), [rows]);
  const boardSessions = board.sessions;

  // The dialog graph also holds the route and service beads, so a step or a
  // gate opened by its deep link keeps its dependency neighbourhood.
  const dialogGraph = useMemo(
    () => buildBeadGraph([...rows, ...routeBeads, ...serviceItems]),
    [rows, routeBeads, serviceItems],
  );
  const selectedBead = useMemo(
    () =>
      rows.find((bead) => bead.id === selectedId) ??
      routeBeads.find((bead) => bead.id === selectedId) ??
      serviceItems.find((bead) => bead.id === selectedId) ??
      null,
    [rows, routeBeads, serviceItems, selectedId],
  );
  const selectedNode = useMemo(
    () => (selectedId === null ? null : (dialogGraph.nodes.get(selectedId) ?? null)),
    [dialogGraph, selectedId],
  );
  const beadAttentionSeverity = useMemo(
    () => (beadId: string) => resourceAttentionSeverity(attention, 'beads', beadId),
    [attention],
  );

  // In-progress liveness notes (gp-6xd): who holds the bead and whether they
  // are alive, or the waiting/stalled reason. While the session read is
  // pending, failed, or partial, `sessionsForNotes` stays undefined so the
  // selector skips session-dependent stall checks instead of calling every
  // assigned card "no live session" against an empty roster.
  const nowMs = useNow();
  const sessionsForNotes = useMemo(
    () =>
      sessions.data === undefined || sessions.data.partial === true
        ? undefined
        : (sessions.data.items ?? []),
    [sessions.data],
  );
  const beadNoteOf = useMemo(() => {
    const notes = new Map<string, string>();
    for (const bead of rows) {
      if (bead.status !== 'in_progress') continue;
      const note = inProgressCardNote(bead, sessionsForNotes, nowMs);
      if (note !== null) notes.set(bead.id, note);
    }
    return (beadId: string) => notes.get(beadId) ?? null;
  }, [rows, sessionsForNotes, nowMs]);

  const renderBeadActions = useCallback(
    (bead: SupervisorBead) => {
      const busy = actionInFlight !== null;
      const actionLabel = actionInFlight === bead.id ? t('closing') : null;

      const roTitle = readOnly ? READ_ONLY_CONTROL_TITLE : undefined;

      return (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {readOnly && <ReadOnlyBadge />}
          {actionLabel && <span className="text-label text-fg-muted">{actionLabel}</span>}
          <Button
            type="button"
            size="sm"
            title={roTitle}
            disabled={readOnly || busy || bead.status === 'closed'}
            onClick={() => {
              setActionMessage(null);
              setClosing(bead);
            }}
          >
            {t('Close bead…')}
          </Button>
        </div>
      );
    },
    [actionInFlight, readOnly],
  );

  const isTruncated =
    typeof upstreamTotal === 'number' &&
    typeof upstreamFetched === 'number' &&
    upstreamFetched < upstreamTotal;
  const totalCards = boardModel.projects[0]?.count ?? 0;

  return (
    <section>
      <PageHeader
        title={t('Beads')}
        meta={
          <>
            {readOnly && <ReadOnlyBadge />}
            <Button size="sm" onClick={() => void refresh()} disabled={loading}>
              {loading && !hasLoadedBoard ? t('Loading') : loading ? t('Refreshing') : t('Refresh')}
            </Button>
          </>
        }
      />

      <PageAlerts messages={[error, sessions.error, rigs.error]} />

      {(isTruncated || actionMessage) && (
        <div className="mb-6 max-w-prose space-y-2 text-body text-fg-muted">
          {isTruncated && (
            <p className="text-warn [overflow-wrap:anywhere]">
              {t('The board read {fetched} of {total} records; some work may be missing.', {
                fetched: upstreamFetched,
                total: upstreamTotal,
              })}
            </p>
          )}
          {actionMessage && (
            <p
              className={actionMessage.tone === 'error' ? 'text-accent' : 'text-fg-muted'}
              role={actionMessage.tone === 'error' ? 'alert' : 'status'}
            >
              {actionMessage.text}
            </p>
          )}
        </div>
      )}

      {/* vk-final: what waits for the owner is «Нужно от меня» in the top bar
          (with its badge); city issues are on Health. */}
      {attention.city.byDomain.beads > 0 && (
        <p className="mb-6 text-body text-fg-muted">
          <Link to="/health" className="text-fg underline underline-offset-2 focus-mark">
            {tn(attention.city.byDomain.beads, {
              one: '{n} task issue is on Health',
              other: '{n} task issues are on Health',
            })}
          </Link>
        </p>
      )}

      <div className="mb-8">
        <BoardFilterBar
          projects={boardModel.projects}
          project={project}
          onProject={setProject}
          search={search}
          onSearch={setSearch}
          matched={boardModel.matched}
          total={totalCards}
          testCount={boardModel.testCount}
          showTests={showTests}
          onShowTests={setShowTests}
          epics={epics}
          epic={epic}
          onEpic={setEpic}
          sources={boardSources}
          ownerFilter={ownerFilter}
          onOwnerFilter={setOwnerFilter}
          newTaskUrl={mayorChannelUrl()}
          plannedEmpty={plannedEmpty}
        />
      </div>

      {!hasLoadedBoard && loading ? (
        <p className="text-body text-fg-muted">{t('Loading beads.')}</p>
      ) : boardModel.matched === 0 &&
        (search.trim().length > 0 ||
          project !== ALL_PROJECTS ||
          epic !== ALL_EPICS ||
          ownerFilter !== 'all') ? (
        <p className="text-body text-fg-muted">{t('No tasks match the search or filter.')}</p>
      ) : boardModel.matched === 0 ? (
        <p className="text-body text-fg-muted">{t('Nothing on the board right now.')}</p>
      ) : (
        <section aria-label={t('Board')} className="min-w-0 space-y-4">
          {boardModel.idle.state !== 'busy' &&
            boardModel.columns.working.length +
              boardModel.columns.review.length +
              boardModel.columns.pr.length ===
              0 && <IdleNotice idle={boardModel.idle} />}
          <BeadBoard
            model={boardModel}
            selectedId={selectedId}
            attentionSeverity={beadAttentionSeverity}
            noteOf={beadNoteOf}
            sessions={boardSessions}
            nowMs={nowMs}
            onSelect={setSelectedId}
            showAllHistory={showAllHistory}
            onToggleHistory={() => setShowAllHistory((prev) => !prev)}
          />
        </section>
      )}

      {hasLoadedBoard && boardModel.orphanRuns > 0 && (
        <p className="mt-6 text-body text-fg-muted">
          {tn(boardModel.orphanRuns, {
            one: '{n} run is not tied to a task on this board.',
            other: '{n} runs are not tied to a task on this board.',
          })}{' '}
          <Link
            to="/runs"
            className="rounded-sm text-fg underline underline-offset-2 focus-mark hover:text-primary"
          >
            {t('Runs')}
          </Link>
        </p>
      )}

      <BeadDetailModal
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
        beadId={selectedId}
        initialBead={selectedBead}
        depNode={selectedNode}
        sessions={sessionItems}
        onOpenBead={setSelectedId}
        renderActions={renderBeadActions}
      />

      <Modal
        open={closing !== null}
        onClose={() => {
          if (actionInFlight === null) setClosing(null);
        }}
        title={closing ? t('Close {id}', { id: closing.id }) : t('Close bead')}
        caption={closing?.title}
        widthClass="max-w-xl"
        footer={
          <>
            <Button
              type="button"
              size="sm"
              tone="quiet"
              disabled={actionInFlight !== null}
              onClick={() => setClosing(null)}
            >
              {t('Cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              tone="accent"
              title={readOnly ? READ_ONLY_CONTROL_TITLE : undefined}
              disabled={readOnly || closing === null || actionInFlight !== null}
              onClick={() => {
                if (closing) void runClose(closing);
              }}
            >
              {t('Close bead')}
            </Button>
          </>
        }
      >
        <p className="text-body text-fg-muted">
          {t('Close this bead? It will be marked closed and drop out of the open queue.')}
        </p>
      </Modal>
    </section>
  );
}

function normalizeSelectedBeadParam(value: string | null): string | null {
  const clean = value?.trim();
  return clean && clean.length > 0 ? clean : null;
}
