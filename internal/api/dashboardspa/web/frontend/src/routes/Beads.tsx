import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { GC_EVENT_PREFIX } from 'gas-city-dashboard-shared';
import { formatApiError } from '../api/client';
import { getActiveCity } from '../api/cityBase';
import { t, tn } from '../i18n';
import { useAttentionModel } from '../attention/context';
import { inProgressCardNote } from '../attention/beadsNeedingAttention';
import { resourceAttentionSeverity } from '../attention/routeHighlight';
import { BeadBoard } from '../components/beads/BeadBoard';
import { epicBeadsOf } from '../vk/board/KanbanColumn';
import { BoardFilterBar } from '../components/beads/BoardFilterBar';
import { IdleNotice } from '../components/beads/IdleNotice';
import { boardSourcesOf, type OwnerFilter, type PeerBoardSource } from '../lib/boardOwner';
import { PEER_SETTLE_CAP_MS, usePeerBoards, usePeerBoardsSettled } from '../hooks/usePeerBoards';
import type { PeerCard } from '../supervisor/peerBoardReads';
import { topicsForCard } from '../lib/peerTopics';
import { peerStatusLines } from '../lib/peerLive';
import { questionsForCard } from '../lib/topicQuestions';
import { CardConversation } from '../vk/comments/CardConversation';
import { TopicsPanel } from '../vk/comments/TopicsPanel';
import { PeerTaskDrawer } from '../vk/panel/PeerTaskDrawer';
import { taskShortLabel } from '../vk/panel/drawerFacts';
import { beadIdOf, buildGraph } from '../vk/graph/model';
import { GraphView } from '../vk/graph/GraphView';
import { buildBoardGraph, type BoardFilter } from '../vk/graph/boardModel';
import { BoardGraphView } from '../vk/graph/BoardGraphView';
import { useThrottledValue } from '../hooks/useThrottledValue';
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
import { useNow } from '../contexts/NowContext';
import { READ_ONLY_CONTROL_TITLE, ReadOnlyBadge, useReadOnly } from '../contexts/ReadOnlyContext';
import { buildBeadGraph } from '../lib/beadGraph';
import { ALL_PROJECTS, buildBoardModel, CITY_PROJECT_KEY, rigProjectLabel } from '../lib/boardModel';
import { isBoardNoise } from '../lib/boardNoise';
import { splitCityRestarting } from '../lib/cityRestarting';
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

/** The all-tickets graph re-lays out at most this often on live data. */
const ALL_GRAPH_RELAYOUT_MS = 4_000;

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
  // VK 1:1 (16.11): the project is chosen by the left rail (`?project=`); with
  // none chosen the board opens on the devwork product, never «Все».
  const projectParam = normalizeSelectedBeadParam(searchParams.get('project'));
  const [projectState, setProjectState] = useState<string | null>(projectParam);
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
  // H1 16.11: the peer lines sit above the board; draw the board once the peer
  // boards have answered (capped), so they never push it down.
  const peerSettled = usePeerBoardsSettled(PEER_SETTLE_CAP_MS);
  const peerSources = peerBoards.sources;
  const boardSources = useMemo(() => boardSourcesOf(peerSources), [peerSources]);
  // review M-1: a peer board that vanishes (service restart) must not leave
  // its filter behind and empty the board under a «Все» chip.
  useEffect(() => {
    if (ownerFilter !== 'all' && ownerFilter !== 'me' && !peerSources.some((p) => p.owner === ownerFilter)) {
      setOwnerFilter('all');
    }
  }, [ownerFilter, peerSources]);
  // polish2 16.11 (owner): the open card IS the URL (`?bead=<id>`), so a link
  // can be shared and survives a reload. Opening or switching a card pushes a
  // history entry (Back closes it, Forward reopens it). Closing a card that
  // this board opened steps back to the entry it came from (review M-1: a
  // replace left a dead Back step); a card that arrived by link (a reload, a
  // shared URL) closes by replacing. Re-selecting the open card is a no-op.
  const selectedId = selectedBeadParam;
  const location = useLocation();
  const navigate = useNavigate();
  // How many card entries this board pushed since an entry with NO card open.
  // 0 means «not steppable»: the chain started at a card reached by link (a
  // reload, a shared URL, «Нужно от меня»), so closing must replace, never go
  // back (re-review: going back reopened that card).
  const navState = location.state as { beadDepth?: number; prevBead?: string } | null;
  const depth = navState?.beadDepth ?? 0;
  // Graph sprint: the card the owner jumped here from along the chain (drawer
  // rows), for the «← <previous>» crumb. Only a chain jump records it.
  const prevBead = navState?.prevBead ?? null;
  const selectBead = useCallback(
    (id: string | null, prev: string | null) => {
      if (id === selectedId) return;
      if (id === null && depth > 0) {
        void navigate(-depth);
        return;
      }
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id === null) next.delete('bead');
          else next.set('bead', id);
          return next;
        },
        id === null
          ? { replace: true }
          : {
              state: {
                beadDepth: selectedId === null || depth > 0 ? depth + 1 : 0,
                ...(prev !== null ? { prevBead: prev } : {}),
              },
            },
      );
    },
    [setSearchParams, selectedId, depth, navigate],
  );
  const setSelectedId = useCallback((id: string | null) => selectBead(id, null), [selectBead]);
  const jumpToBead = useCallback((id: string) => selectBead(id, selectedId), [selectBead, selectedId]);
  // Graph sprint: «Доска | Граф» (`?view=graph`). Owner 16.11: always shown;
  // the graph itself is per epic (or a focused chain, `?focus=<id>`), and with
  // «Все» the graph view holds the all-tickets graph's placeholder.
  const viewGraphParam = searchParams.get('view') === 'graph';
  const focusParam = normalizeSelectedBeadParam(searchParams.get('focus'));
  const setView = useCallback(
    (view: 'board' | 'graph', focus?: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (view === 'graph') next.set('view', 'graph');
          else {
            next.delete('view');
            next.delete('focus');
          }
          if (focus !== undefined) next.set('focus', focus);
          return next;
        },
        { replace: true, state: location.state },
      );
    },
    [setSearchParams, location.state],
  );
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
  // Progressive loading (owner 16.11): the unscoped read takes seconds under
  // load, the project's rig read a tenth of one. The board draws from the rig
  // read first and fills in when the unscoped read lands.
  const unscopedIn = board.data !== undefined;
  const fastRig = useMemo(() => {
    const name = projectState ?? defaultBoardProject(board.rigs);
    return board.rigs.some((rig) => rig.name === name) ? name : null;
  }, [projectState, board.rigs]);
  const fastKey = !unscopedIn && !showAllHistory && fastRig !== null ? fastRig : 'off';
  const fast = useCachedData(`beads:board:${cityCacheKey}:fast-rig:${fastKey}`, () =>
    fastKey === 'off'
      ? Promise.resolve(null)
      : // No withRoutes: a rig read with routes adds an unscoped route leg, the
        // very read this one is here to outrun. Routes fill in with it.
        listSupervisorBeads({ rigFilter: fastKey }),
  );
  const fastData = useMemo(() => boardDataOf(fast.data), [fast.data]);
  const data = showAllHistory ? historyData : (board.data ?? fastData);
  const boardPartial = !showAllHistory && !unscopedIn && fastData !== undefined;
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
  // VK 1:1: engine bookkeeping rows (plan-review rounds, PR repairs, stall
  // alarms; lib/boardNoise) never become cards; they stay aside as service
  // beads so a blocker can still be named.
  const allRows = useMemo(() => data?.items ?? EMPTY_BEADS, [data]);
  const rows = useMemo(() => allRows.filter((bead) => !isBoardNoise(bead)), [allRows]);
  const routeBeads = useMemo(() => data?.routeItems ?? EMPTY_BEADS, [data]);
  const serviceItems = useMemo(
    () => [...(data?.serviceItems ?? EMPTY_BEADS), ...allRows.filter(isBoardNoise)],
    [data, allRows],
  );
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
    if (epicParam !== null) setEpic(epicParam);
  }, [epicParam]);

  useEffect(() => {
    if (projectParam !== null) setProjectState(projectParam);
  }, [projectParam]);
  const project = projectState ?? defaultBoardProject(rigItems);

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
    const none = { rig: null, topics: [], questions: [] } as const;
    const id = selectedId;
    if (id === null || isPeerKey(id)) return none;
    const rig = rigItems.find((r) => {
      const prefix = r.prefix?.trim() ?? '';
      return prefix.length > 0 && id.startsWith(`${prefix}-`);
    });
    if (rig === undefined) return none;
    const ref = { mine: true, city: ownLogin, rig: rig.name, id };
    return {
      rig: rig.name,
      topics: topicsForCard(peerBoards.result, ref),
      // BOARD-LIVE L7: the owner's question about this card (one of three views)
      questions: questionsForCard(peerBoards.result, ref),
    };
  }, [selectedId, rigItems, peerBoards.result, ownLogin]);
  const openTopicFromCard = useCallback(
    (login: string, topicId: string) => {
      // one URL write: two functional updates in one tick would race
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('bead');
          next.set('topics', login);
          next.set('topic', topicId);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const ownSelectedId = selectedId !== null && isPeerKey(selectedId) ? null : selectedId;
  const epics = useMemo(
    () => epicSummaries(rows, { closedCapped: !showAllHistory }),
    [rows, showAllHistory],
  );
  // vk11/card: a card names its epic, so the lookup also holds the epic beads.
  const epicBeads = useMemo(() => epicBeadsOf(allRows), [allRows]);
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
  const graphAvailable = epic !== ALL_EPICS || focusParam !== null;
  const showGraph = viewGraphParam && graphAvailable;
  // «Эпик: Все» + «Граф»: the all-tickets graph (ALL-README).
  const showAllGraph = viewGraphParam && !graphAvailable;
  const anyGraph = showGraph || showAllGraph;
  // Graph integration 16.11: the unscoped window can miss a rig's tasks (the
  // model lane saw 2 of the M04 beads unscoped, all of them with rig=devwork),
  // so the graph also reads each rig's own open work store, merged by id.
  const graphRigNames = useMemo(
    () => [...new Set(rigItems.map((rig) => rig.name).filter((name) => name.length > 0))].sort(),
    [rigItems],
  );
  const graphRigs = useCachedData(
    `beads:board:${cityCacheKey}:graph-rigs:${anyGraph ? graphRigNames.join(',') : 'off'}`,
    () =>
      anyGraph && graphRigNames.length > 0
        ? Promise.all(
            graphRigNames.map((rig) =>
              listSupervisorBeads({ rigFilter: rig })
                .then((list) => list.items)
                .catch(() => [] as SupervisorBead[]),
            ),
          ).then((legs) => legs.flat())
        : Promise.resolve([] as SupervisorBead[]),
  );
  const refreshGraphRigs = graphRigs.refresh;
  useGcEventRefresh(
    [GC_EVENT_PREFIX.bead],
    () => {
      if (anyGraph) void refreshGraphRigs();
    },
    { coalesceMs: BOARD_REFRESH_COALESCE_MS },
  );
  const graphRows = useMemo(() => {
    const seen = new Set<string>();
    const out: SupervisorBead[] = [];
    for (const bead of [...allRows, ...(graphRigs.data ?? []), ...serviceItems]) {
      if (seen.has(bead.id)) continue;
      seen.add(bead.id);
      out.push(bead);
    }
    return out;
  }, [allRows, graphRigs.data, serviceItems]);
  // Until every read is in, the graphs are built from what has arrived and
  // marked partial (no «никто не взял», ALL-README rule 11).
  const graphRigsIn = graphRigNames.length === 0 || graphRigs.data !== undefined;
  const graphPartial = !unscopedIn || !graphRigsIn;
  const graphModel = useMemo(
    () =>
      showGraph
        ? buildGraph(graphRows, {
            epicId: focusParam !== null ? null : epic,
            ...(focusParam !== null ? { focusIds: [focusParam] } : {}),
            nowMs,
            ...(graphPartial ? { partial: true } : {}),
          })
        : null,
    [showGraph, graphRows, epic, focusParam, nowMs, graphPartial],
  );
  // Owner 16.11: on the all-tickets graph a card's chain sat far off screen.
  // A graph click selects the card (drawer, ?bead=) AND narrows the graph to
  // its chain (?focus=, the same param the per-epic graph understands): the
  // card, its ancestors and descendants, and the owner questions holding
  // them, side by side. Another click refocuses; Esc or «← весь граф» returns
  // to the full graph (drawer closed, scroll restored).
  const focusScrollY = useRef<number | null>(null);
  const focusChain = useCallback(
    (nodeId: string) => {
      const id = beadIdOf(nodeId);
      if (focusParam === null) focusScrollY.current = window.scrollY;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('view', 'graph');
          next.set('focus', id);
          next.set('bead', id);
          return next;
        },
        { state: { beadDepth: selectedId === null || depth > 0 ? depth + 1 : 0 } },
      );
    },
    [setSearchParams, focusParam, selectedId, depth],
  );
  const exitFocus = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('focus');
        next.delete('bead');
        return next;
      },
      { replace: true, state: null },
    );
    const y = focusScrollY.current;
    focusScrollY.current = null;
    if (y !== null) window.requestAnimationFrame(() => window.scrollTo(0, y));
  }, [setSearchParams]);
  const graphFocused = viewGraphParam && focusParam !== null;
  useEffect(() => {
    if (!graphFocused) return;
    // Capture phase: Esc leaves the chain before the drawer's own Esc runs.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      exitFocus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [graphFocused, exitFocus]);
  const focusHeader = useMemo(() => {
    if (!graphFocused || graphModel === null || focusParam === null) return null;
    // Tasks only: an owner-question card («<id>::q») is not a task.
    const tasks = graphModel.nodes.filter((n) => n.kind === 'task' && beadIdOf(n.id) === n.id);
    const self = tasks.find((n) => beadIdOf(n.id) === focusParam);
    return {
      label: self?.label ?? focusParam,
      n: tasks.length,
    };
  }, [graphFocused, graphModel, focusParam]);
  // Live data re-lays the all-tickets graph out at most every few seconds
  // (rule 16); collapse and filter are the page's own state.
  const [laneCollapsed, setLaneCollapsed] = useState<Record<string, boolean>>({});
  const [graphFilter, setGraphFilter] = useState<BoardFilter>('all');
  // A read landing (rig → unscoped) shows at once; live churn is throttled.
  const liveAllGraphRows = useThrottledValue(
    graphRows,
    ALL_GRAPH_RELAYOUT_MS,
    `${unscopedIn}:${graphRigsIn}:${graphRows.length > 0}`,
  );
  const allGraph = useMemo(
    () =>
      showAllGraph
        ? buildBoardGraph(liveAllGraphRows, {
            nowMs,
            partial: graphPartial,
            collapsed: laneCollapsed,
            filter: graphFilter,
          })
        : null,
    [showAllGraph, liveAllGraphRows, nowMs, graphPartial, laneCollapsed, graphFilter],
  );
  const toggleLane = useCallback(
    (key: string) => {
      const lane = allGraph?.lanes.find((l) => l.key === key);
      setLaneCollapsed((prev) => ({ ...prev, [key]: !(lane?.collapsed ?? prev[key] ?? false) }));
    },
    [allGraph],
  );
  const openEpicGraph = useCallback(
    (key: string) => {
      setEpic(key);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('epic', key);
          next.set('view', 'graph');
          next.delete('focus');
          return next;
        },
        { replace: true, state: location.state },
      );
    },
    [setSearchParams, location.state],
  );
  // The board's search box finds a card on the all-tickets graph: it is
  // selected (drawer + ?bead=) and the view scrolls to it.
  // Each query selects once (live re-layouts never steal the selection back).
  const searchedFor = useRef('');
  useEffect(() => {
    const q = search.trim().toLowerCase();
    if (!showAllGraph || q.length === 0) {
      searchedFor.current = '';
      return;
    }
    if (allGraph === null || searchedFor.current === q) return;
    const hit = allGraph.nodes.find(
      (n) => n.kind === 'task' && `${n.id} ${n.label} ${n.title}`.toLowerCase().includes(q),
    );
    if (hit === undefined) return;
    searchedFor.current = q;
    setSelectedId(beadIdOf(hit.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, showAllGraph, allGraph]);
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

  // A column «+» starts a task the way «Новая задача» does: in the Mayor's channel.
  const openNewTask = useCallback(() => {
    const url = mayorChannelUrl();
    if (typeof url === 'string' && url.length > 0) window.open(url, '_blank', 'noopener,noreferrer');
  }, []);
  // Main.dc.html: on a wide screen an open task sits beside the board (the
  // drawer is 560 px at the right), so the board makes room instead of hiding.
  const drawerOpen = selectedId !== null && (selectedPeer !== null || ownSelectedId !== null);

  const pageErrors = splitCityRestarting([error, sessions.error, rigs.error]);
  const isTruncated =
    typeof upstreamTotal === 'number' &&
    typeof upstreamFetched === 'number' &&
    upstreamFetched < upstreamTotal;
  const totalCards = boardModel.projects[0]?.count ?? 0;

  return (
    <section
      data-drawer-open={drawerOpen ? 'true' : undefined}
      className={drawerOpen ? 'min-w-0 xl:mr-[560px]' : 'min-w-0'}
    >
      {/* VK 1:1 (Main.dc.html): the page title is the project's name with a
          «···» menu; no «Обновить» (the board refreshes on events). */}
      <div className="flex items-center gap-1 pb-2 pt-4 font-vk-sans">
        <h1 className="m-0 text-2xl font-medium text-vk-text-high">{boardTitle(project)}</h1>
        <button
          type="button"
          aria-label={t('More')}
          className="flex h-7 w-7 items-center justify-center rounded-sm text-vk-text-low focus-mark hover:text-vk-text-high"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
            <circle cx="8" cy="8" r="1.3" fill="currentColor" />
            <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
          </svg>
        </button>
        {readOnly && <ReadOnlyBadge />}
      </div>

      {pageErrors.restarting && (
        <p role="status" className="mb-4 font-vk-sans text-[15px] text-vk-text-low">
          {t('The city is restarting… data will appear in a minute')}
        </p>
      )}
      <PageAlerts messages={pageErrors.rest} />
      {(boardPartial || (anyGraph && graphPartial && hasLoadedBoard)) && !pageErrors.restarting && (
        <p role="status" className="mb-3 font-vk-sans text-sm text-vk-text-low">
          {t('Data still loading…')}
        </p>
      )}

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

      {/* H1 16.11: the filter bar and the peer lines join with the board, once
          the cards and the peer boards are read, so nothing above the board
          grows after it is drawn (layout shift). */}
      {!((!hasLoadedBoard && loading) || !peerSettled) && (
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
          afterEpic={<ViewSwitch graph={viewGraphParam} onView={(v) => setView(v)} />}
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
        {/* BOARD-LIVE L7: «не в сети с», «данные на … — изменений может не
            хватать», a refused pair key (lib/peerLive; our clock, not his) */}
        {peerSources.flatMap((peer) =>
          peerStatusLines(peer).map((line) => (
            <p
              key={`${peer.owner}:${line}`}
              role="status"
              className="mt-3 flex items-center gap-2 rounded-sm border border-warn/40 bg-warn/10 px-3 py-2 font-vk-sans text-[15px] text-vk-text-high"
            >
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-warn" />
              {line}
            </p>
          )),
        )}
        {peerBoards.error !== null && (
          <p className="mt-3 font-vk-sans text-sm text-vk-text-low">
            {t('The other city’s board could not be read.')}
          </p>
        )}
      </div>
      )}

      {(!hasLoadedBoard && loading) || !peerSettled ? (
        <p className="text-body text-fg-muted">{t('Loading beads.')}</p>
      ) : showAllGraph && allGraph !== null ? (
        <section aria-label={t('Graph')} className="min-w-0 space-y-3">
          <GraphFilterSwitch value={graphFilter} onChange={setGraphFilter} />
          <BoardGraphView
            graph={allGraph}
            selectedId={selectedId}
            onSelect={focusChain}
            onAnswer={(id) => setSelectedId(beadIdOf(id))}
            onToggleLane={toggleLane}
            onOpenEpic={openEpicGraph}
          />
        </section>
      ) : showGraph && graphModel !== null ? (
        <section aria-label={t('Graph')} className="min-w-0 space-y-3">
          {focusHeader !== null && (
            <div
              role="status"
              data-testid="graph-focus-header"
              className="flex flex-wrap items-center gap-3 font-vk-sans text-[15px] text-vk-text-high"
            >
              <span>
                {tn(
                  focusHeader.n,
                  { one: 'Chain: {label} · {n} task', other: 'Chain: {label} · {n} tasks' },
                  { label: focusHeader.label },
                )}
              </span>
              <Button type="button" size="sm" onClick={exitFocus}>
                {t('← full graph')}
              </Button>
            </div>
          )}
          <GraphView
            model={graphModel}
            selectedId={selectedId}
            onSelect={focusChain}
            onAnswer={(id) => setSelectedId(beadIdOf(id))}
          />
        </section>
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
            onAddTask={openNewTask}
            epicBeads={epicBeads}
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
          questions={questionsForCard(peerBoards.result, {
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
        questions={ownCard.questions}
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
            onOpenBead={jumpToBead}
            renderActions={renderBeadActions}
            onShowOnGraph={() => {
              if (ownSelectedId === null) return;
              setView('graph', epic === ALL_EPICS || focusParam !== null ? ownSelectedId : undefined);
            }}
            graphChain={anyGraph ? { cameFrom: prevBead } : null}
            backCrumb={
              prevBead !== null && prevBead !== ownSelectedId
                ? { label: crumbLabel(prevBead, allRows), onBack: () => jumpToBead(prevBead) }
                : null
            }
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

/** «Доска | Граф» (graph sprint 16.11): a two-button segmented control. */
function ViewSwitch({ graph, onView }: { graph: boolean; onView: (view: 'board' | 'graph') => void }) {
  const button = (on: boolean, view: 'board' | 'graph', label: string) => (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => {
        if (!on) onView(view);
      }}
      className={
        on
          ? 'inline-flex h-11 items-center rounded-[2px] bg-vk-bg-panel px-3 text-[15px] text-vk-text-high focus-mark md:h-7'
          : 'inline-flex h-11 items-center rounded-[2px] px-3 text-[15px] text-vk-text-low hover:text-vk-text-high focus-mark md:h-7'
      }
    >
      {label}
    </button>
  );
  return (
    <div
      role="group"
      aria-label={t('View')}
      className="inline-flex items-center gap-0.5 rounded-[3px] border border-vk-border bg-vk-bg-primary p-0.5 font-vk-sans"
    >
      {button(!graph, 'board', t('Board'))}
      {button(graph, 'graph', t('Graph'))}
    </div>
  );
}

const GRAPH_FILTERS: ReadonlyArray<[BoardFilter, string]> = [
  ['all', 'Everything'],
  ['holds_me', 'Only what holds me'],
  ['stuck', 'Only stuck'],
  ['in_work', 'Only in work'],
];

/** The all-tickets graph's quick filters, a small segmented control. */
function GraphFilterSwitch({ value, onChange }: { value: BoardFilter; onChange: (v: BoardFilter) => void }) {
  return (
    <div
      role="group"
      aria-label={t('Graph filter')}
      className="inline-flex flex-wrap items-center gap-0.5 rounded-[3px] border border-vk-border bg-vk-bg-primary p-0.5 font-vk-sans"
    >
      {GRAPH_FILTERS.map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={
            value === key
              ? 'inline-flex h-11 items-center rounded-[2px] bg-vk-bg-panel px-3 text-[14px] text-vk-text-high focus-mark md:h-7'
              : 'inline-flex h-11 items-center rounded-[2px] px-3 text-[14px] text-vk-text-low hover:text-vk-text-high focus-mark md:h-7'
          }
        >
          {t(label)}
        </button>
      ))}
    </div>
  );
}

/** The crumb's short label for a bead id («M04 #3»), never the raw id when known. */
function crumbLabel(id: string, rows: readonly SupervisorBead[]): string {
  const bead = rows.find((b) => b.id === id);
  return bead === undefined ? id : taskShortLabel(bead);
}

/** The project the board opens on: the devwork product rig, else the first rig. */
export function defaultBoardProject(rigs: readonly { name: string; prefix?: string }[]): string {
  const withPrefix = rigs.filter((rig) => (rig.prefix?.trim() ?? '').length > 0);
  const devwork = withPrefix.find((rig) => rig.name === 'devwork');
  return devwork?.name ?? withPrefix[0]?.name ?? ALL_PROJECTS;
}

/** «Продукт devwork» for a rig, «Сам город» for the city. */
function boardTitle(project: string): string {
  if (project === CITY_PROJECT_KEY) return t('The city itself');
  if (project === ALL_PROJECTS) return t('All projects');
  return rigProjectLabel(project);
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
