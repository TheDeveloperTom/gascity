import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { isLaunchState } from '../embed/LaunchCardOpener';
import { SupervisorApiError } from '../supervisor/client';
import { Toast } from '../vk/Toast';
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
import { asOfClock, boardSourcesOf, type OwnerFilter, type PeerBoardSource } from '../lib/boardOwner';
import { usePeerBoards } from '../hooks/usePeerBoards';
import type { PeerCard } from '../supervisor/peerBoardReads';
import { topicsForCard } from '../lib/peerTopics';
import { CardConversation } from '../vk/comments/CardConversation';
import { TopicsPanel } from '../vk/comments/TopicsPanel';
import { PeerTaskDrawer } from '../vk/panel/PeerTaskDrawer';
import type { BoardCard } from '../lib/boardModel';
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
import { fetchSupervisorBead, listSupervisorBeads, type SupervisorBead } from '../supervisor/beadReads';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedBeadParam = normalizeSelectedBeadParam(searchParams.get('bead'));
  // «Вся история» widens the fetch to closed beads (the old `closed` chip's
  // data effect). It drives BOTH the fetch (includeClosed) and the cache key.
  const [showAllHistory, setShowAllHistory] = useState(false);
  // vk-final: `?project=<key>` preselects the project and follows the menu.
  const projectParam = normalizeSelectedBeadParam(searchParams.get('project'));
  const [project, setProjectState] = useState<string>(projectParam ?? ALL_PROJECTS);
  const setProject = useCallback(
    (key: string) => {
      setProjectState(key);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (key === ALL_PROJECTS) next.delete('project');
          else next.set('project', key);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const [search, setSearch] = useState('');
  const [showTests, setShowTests] = useState(false);
  const epicParam = normalizeSelectedBeadParam(searchParams.get('epic'));
  const [epic, setEpic] = useState<string>(epicParam ?? ALL_EPICS);
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all');
  // vk-final part 3: the peers' read-only boards (city service peer-boards).
  const peerBoards = usePeerBoards();
  const peerSources = peerBoards.sources;
  const boardSources = useMemo(() => boardSourcesOf(peerSources), [peerSources]);
  // review M-1: a peer board that vanishes (service restart) must not leave
  // its filter behind and empty the board under a «Все» chip.
  useEffect(() => {
    if (ownerFilter !== 'all' && ownerFilter !== 'me' && !peerSources.some((p) => p.owner === ownerFilter)) {
      setOwnerFilter('all');
    }
  }, [ownerFilter, peerSources]);
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

  useEffect(() => {
    if (projectParam !== null) setProjectState(projectParam);
  }, [projectParam]);

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
        peerSources,
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
      peerSources,
    ],
  );
  // A peer card is selected by its board key (`peer:<login>:<rig>:<id>`);
  // it opens the read-only peer window, never the bead panel.
  const selectedPeer = useMemo(() => peerCardOf(peerSources, selectedId), [peerSources, selectedId]);
  // Part 4 (owner, 15.11): a card conversation is a Mayor topic linked to the
  // card (`topic.card`); there are no human comments on cards.
  const peerTopicCount = useMemo(() => {
    const byKey = new Map<string, number>();
    for (const peer of peerBoards.result?.peers ?? []) {
      for (const topic of peer.topics) {
        const ref = topic.card;
        // trusted keys only: a topic counts on HIS card only from HIS board
        if (ref === null || ref.city !== peer.login) continue;
        const key = `peer:${ref.city}:${ref.rig}:${ref.id}`;
        byKey.set(key, (byKey.get(key) ?? 0) + topic.messages.length);
      }
    }
    return byKey;
  }, [peerBoards.result]);
  // Part 4: Mayor topics with a peer city. `?topics=<login>` opens the panel,
  // `&topic=<id>` the thread (links from «Нужно от меня»).
  const topicsLogin = normalizeSelectedBeadParam(searchParams.get('topics'));
  const topicParam = normalizeSelectedBeadParam(searchParams.get('topic'));
  const setTopicsParams = useCallback(
    (login: string | null, topicId: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (login === null) next.delete('topics');
          else next.set('topics', login);
          if (topicId === null) next.delete('topic');
          else next.set('topic', topicId);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const topicsPeer = useMemo(
    () => (topicsLogin === null ? null : (peerSources.find((p) => p.login === topicsLogin) ?? null)),
    [peerSources, topicsLogin],
  );
  const topicsOf = useCallback(
    (login: string) => peerBoards.result?.peers.find((p) => p.login === login)?.topics ?? [],
    [peerBoards.result],
  );
  const commentCountOf = useCallback(
    (card: BoardCard) => (card.peer === null ? 0 : (peerTopicCount.get(card.key) ?? 0)),
    [peerTopicCount],
  );
  // OUR card: its rig (the rig whose prefix starts the id), our login from
  // OUR city service (`own_login`; never from peer topics), and the topics
  // that reference {our login, rig, id}. Who the box writes to is decided in
  // CardConversation from these trusted facts only (security scan 15.11).
  const ownLogin = peerBoards.result?.ownLogin ?? null;
  const ownCard = useMemo(() => {
    const none = { rig: null, topics: [] } as const;
    const id = selectedId;
    if (id === null || isPeerKey(id)) return none;
    const rig = rigItems.find((r) => {
      const prefix = r.prefix?.trim() ?? '';
      return prefix.length > 0 && id.startsWith(`${prefix}-`);
    });
    if (rig === undefined) return none;
    return { rig: rig.name, topics: topicsForCard(peerBoards.result, { mine: true, city: ownLogin, rig: rig.name, id }) };
  }, [selectedId, rigItems, peerBoards.result, ownLogin]);
  const openTopicFromCard = useCallback(
    (login: string, topicId: string) => {
      setSelectedId(null);
      setTopicsParams(login, topicId);
    },
    [setTopicsParams],
  );
  // Part 5: the Activity was launched for a card (LaunchCardOpener). Until
  // the id is found on the board or read directly, the bead panel stays
  // closed; an unknown id clears `bead` and shows one toast instead.
  const location = useLocation();
  const launchBead = isLaunchState(location.state) ? location.state.launchBead : null;
  const [launchCheck, setLaunchCheck] = useState<'idle' | 'checking' | 'done'>('idle');
  const [toast, setToast] = useState<string | null>(null);
  const checkedLaunch = useRef<string | null>(null);
  const launchOnBoard =
    launchBead !== null &&
    (rows.some((b) => b.id === launchBead) ||
      routeBeads.some((b) => b.id === launchBead) ||
      serviceItems.some((b) => b.id === launchBead));
  useEffect(() => {
    if (launchBead === null || checkedLaunch.current === launchBead || !hasLoadedBoard) return;
    checkedLaunch.current = launchBead;
    if (launchOnBoard) {
      setLaunchCheck('done');
      return;
    }
    setLaunchCheck('checking');
    fetchSupervisorBead(launchBead).then(
      () => setLaunchCheck('done'),
      (err: unknown) => {
        setLaunchCheck('done');
        if (!(err instanceof SupervisorApiError) || err.status !== 404) return;
        setSelectedId(null);
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete('bead');
            return next;
          },
          { replace: true, state: null },
        );
        setToast(t('Task {id} not found — maybe closed or from another city', { id: launchBead }));
      },
    );
  }, [launchBead, launchOnBoard, hasLoadedBoard, setSearchParams]);
  const clearToast = useCallback(() => setToast(null), []);
  const launchPending = launchBead !== null && selectedId === launchBead && launchCheck !== 'done';
  const ownSelectedId =
    selectedId !== null && (isPeerKey(selectedId) || launchPending) ? null : selectedId;
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
        {peerSources.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {peerSources.map((peer) => {
              const topics = topicsOf(peer.login);
              const attention = topics.filter(
                (tp) => (tp.status === 'paused' && tp.pausedReason === 'needs_human') || tp.unreadCount > 0,
              ).length;
              return (
                <button
                  key={peer.owner}
                  type="button"
                  onClick={() => setTopicsParams(peer.login, null)}
                  className="inline-flex h-11 items-center gap-2 rounded-[3px] border border-vk-border bg-vk-bg-primary px-2.5 font-vk-sans text-[15px] text-vk-text-high focus-mark md:h-8"
                >
                  <span aria-hidden="true" className="h-3.5 w-0.5 bg-vk-peer" />
                  {t('Topics with {owner} city', { owner: peer.label })}
                  {attention > 0 && (
                    <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-vk-brand-secondary px-[5px] text-[11px] font-semibold text-vk-on-brand tnum">
                      {attention}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {peerSources
          .filter((peer) => peer.stale)
          .map((peer) => (
            <p
              key={peer.owner}
              role="status"
              className="mt-3 flex items-center gap-2 rounded-sm border border-warn/40 bg-warn/10 px-3 py-2 font-vk-sans text-[15px] text-vk-text-high"
            >
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-warn" />
              {t("{owner} Mac is offline since {time}", { owner: peer.label, time: asOfClock(peer.asOf) })}
            </p>
          ))}
        {peerBoards.error !== null && (
          <p className="mt-3 font-vk-sans text-sm text-vk-text-low">
            {t('The other city’s board could not be read.')}
          </p>
        )}
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
            [...boardModel.columns.working, ...boardModel.columns.review, ...boardModel.columns.pr].filter(
              (card) => card.peer === null,
            ).length === 0 && <IdleNotice idle={boardModel.idle} />}
          <BeadBoard
            model={boardModel}
            selectedId={selectedId}
            attentionSeverity={beadAttentionSeverity}
            noteOf={beadNoteOf}
            sessions={boardSessions}
            nowMs={nowMs}
            onSelect={setSelectedId}
            commentCountOf={commentCountOf}
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

      {toast !== null && <Toast text={toast} onDone={clearToast} />}

      {topicsPeer !== null && (
        <TopicsPanel
          open
          onClose={() => setTopicsParams(null, null)}
          peer={topicsPeer}
          topics={topicsOf(topicsPeer.login)}
          selectedTopicId={topicParam}
          onSelectTopic={(id) => setTopicsParams(topicsPeer.login, id)}
          nowMs={nowMs}
          ownLogin={ownLogin}
        />
      )}

      {selectedPeer !== null && (
        <CardConversation
          key={selectedId ?? ''}
          topics={topicsForCard(peerBoards.result, {
            mine: false,
            city: selectedPeer.peer.login,
            rig: selectedPeer.card.rig,
            id: selectedPeer.card.bead.id,
          })}
          peers={[selectedPeer.peer]}
          card={{
            city: selectedPeer.peer.login,
            rig: selectedPeer.card.rig,
            id: selectedPeer.card.bead.id,
            title: selectedPeer.card.bead.title,
          }}
          ours={false}
          nowMs={nowMs}
          onOpenTopic={openTopicFromCard}
        >
          {({ thread, composer }) => (
            <PeerTaskDrawer
              open
              onClose={() => setSelectedId(null)}
              bead={selectedPeer.card.bead}
              rig={selectedPeer.card.rig}
              name={selectedPeer.peer.name}
              label={selectedPeer.peer.label}
              avatar={selectedPeer.peer.avatar}
              asOf={selectedPeer.peer.asOf}
              stale={selectedPeer.peer.stale}
              footer={composer}
            >
              {thread}
            </PeerTaskDrawer>
          )}
        </CardConversation>
      )}

      <CardConversation
        key={`own:${ownSelectedId ?? ''}`}
        topics={ownCard.topics}
        peers={peerSources}
        card={{ city: ownLogin, rig: ownCard.rig ?? '', id: ownSelectedId ?? '', title: selectedBead?.title ?? '' }}
        ours
        nowMs={nowMs}
        onOpenTopic={openTopicFromCard}
      >
        {({ thread, composer }) => (
          <BeadDetailModal
            open={ownSelectedId !== null}
            onClose={() => setSelectedId(null)}
            beadId={ownSelectedId}
            initialBead={selectedBead}
            extra={ownCard.rig !== null && ownLogin !== null && peerSources.length > 0 ? thread : null}
            footer={ownCard.rig !== null ? composer : null}
            depNode={selectedNode}
            sessions={sessionItems}
            onOpenBead={setSelectedId}
            renderActions={renderBeadActions}
          />
        )}
      </CardConversation>

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

function isPeerKey(key: string): boolean {
  return key.startsWith('peer:');
}

/** The peer card a board key (`peer:<login>:<rig>:<id>`) names, or null. */
function peerCardOf(
  peers: readonly PeerBoardSource[],
  key: string | null,
): { peer: PeerBoardSource; card: PeerCard } | null {
  if (key === null || !isPeerKey(key)) return null;
  for (const peer of peers) {
    const prefix = `${peer.owner}:`;
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    const card = peer.cards.find((c) => `${c.rig}:${c.bead.id}` === rest);
    if (card !== undefined) return { peer, card };
  }
  return null;
}

function normalizeSelectedBeadParam(value: string | null): string | null {
  const clean = value?.trim();
  return clean && clean.length > 0 ? clean : null;
}
