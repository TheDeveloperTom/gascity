import { t } from '../i18n';
import type { SupervisorBead } from '../supervisor/beadReads';
import { buildBeadGraph } from './beadGraph';
import { DEFAULT_OWNER, type CardOwner, type OwnerFilter } from './boardOwner';
import { ALL_EPICS, NO_EPIC } from './epics';
import { beadRole } from './boardRoles';
import {
  buildRouteIndex,
  buildStageColumns,
  safeExternalUrl,
  STAGES,
  stopCardsByTask,
  type StageCard,
  type StageId,
} from './stageBoard';
import {
  buildWaitersIndex,
  cardWait,
  explainIdle,
  milestoneOf,
  MILESTONE_LABEL_PREFIX,
  type CardWait,
  type IdleExplanation,
} from './waitReasons';

// One board model (OWNER-HOME-PLAN B4; RB1, RB3, RB4, RB5, RB8). Every
// project's tasks sit on one board; a card's project is the rig whose API
// prefix starts its id, else the city. Stage placement is the stage board's
// own (lib/stageBoard.ts); this module only filters, tags and groups.

export const TEST_LABEL = 'kind:test';
export const WAITING_FOLD_AT = 12;
export const MERGED_VISIBLE = 5;
export const BUSY_VISIBLE = 12;
export const ALL_PROJECTS = 'all';
export const CITY_PROJECT_KEY = 'city';

const STOPPED_CARD_KEY = 'devwork.stopped_card';
const KIND_KEY = 'gc.kind';
const ROOT_ID_KEY = 'gc.root_bead_id';

export type RigPrefix = { name: string; prefix?: string };

export interface ProjectRef {
  key: string;
  label: string;
  kind: 'rig' | 'city';
}

export interface BoardCard extends StageCard {
  project: ProjectRef;
  /** Whose board the card came from (lib/boardOwner seam; today always DEFAULT_OWNER). */
  owner: CardOwner;
  tag: string | null;
  wait: CardWait | null;
  holds: number;
  isTest: boolean;
}

export interface WaitingGroup {
  key: string;
  name: string;
  subtitle: string | null;
  cards: readonly BoardCard[];
}

export interface BoardData {
  items: readonly SupervisorBead[];
  routeItems: readonly SupervisorBead[];
  serviceItems: readonly SupervisorBead[];
  routesComplete: boolean;
  /** Size of the open window upstream, when the read reported it. */
  upstreamTotal?: number;
  /** How many open beads the read fetched. */
  upstreamFetched?: number;
}

export interface BoardFilters {
  project: string;
  search: string;
  showTests: boolean;
  /** Milestone key, `ALL_EPICS` (default) or `NO_EPIC` (cards without a milestone). */
  epic?: string;
  /** Whose cards: `'all'` (default) or one owner. */
  owner?: OwnerFilter;
}

export interface BoardModel {
  projects: readonly { key: string; label: string; count: number }[];
  testCount: number;
  columns: Readonly<Record<StageId, readonly BoardCard[]>>;
  waitingGroups: readonly WaitingGroup[];
  foldWaiting: boolean;
  idle: IdleExplanation;
  orphanRuns: number;
  matched: number;
  /**
   * The one reverse blocker index of this model: task id → the open tasks
   * that wait on it (`needs` and `blocks` edges). Card hold counts and the
   * «Застряло» blocker check both read it (board-review Minor 4).
   */
  waitersOf: ReadonlyMap<string, readonly string[]>;
}

function cityRef(): ProjectRef {
  return { key: CITY_PROJECT_KEY, label: t('City'), kind: 'city' };
}

export function projectOf(bead: SupervisorBead, rigs: readonly RigPrefix[]): ProjectRef {
  for (const rig of rigs) {
    const prefix = rig.prefix?.trim() ?? '';
    if (prefix.length > 0 && bead.id.startsWith(`${prefix}-`)) {
      return { key: rig.name, label: rig.name, kind: 'rig' };
    }
  }
  return cityRef();
}

function meta(bead: SupervisorBead, key: string): string {
  return bead.metadata?.[key]?.trim() ?? '';
}

function isTestBead(bead: SupervisorBead): boolean {
  return (bead.labels ?? []).includes(TEST_LABEL);
}

function matchesSearch(bead: SupervisorBead, needle: string): boolean {
  if (needle.length === 0) return true;
  const hay = [bead.id, bead.title, ...(bead.labels ?? []), bead.assignee ?? '']
    .join('\n')
    .toLowerCase();
  return hay.includes(needle);
}

/** Epics that head a group: a card names them as parent, or shares their stage label. */
function headingEpics(tasks: readonly SupervisorBead[]): Set<string> {
  const parents = new Set<string>();
  const stages = new Set<string>();
  for (const bead of tasks) {
    if (bead.issue_type === 'epic') continue;
    if (bead.parent) parents.add(bead.parent);
    const stage = milestoneOf(bead);
    if (stage !== null) stages.add(stage);
  }
  const heads = new Set<string>();
  for (const bead of tasks) {
    if (bead.issue_type !== 'epic') continue;
    const stage = milestoneOf(bead);
    if (parents.has(bead.id) || (stage !== null && stages.has(stage))) heads.add(bead.id);
  }
  return heads;
}

const GROUP_RANK = { milestone: 0, epic: 1, none: 2 } as const;

function groupWaiting(
  cards: readonly BoardCard[],
  tasks: readonly SupervisorBead[],
): WaitingGroup[] {
  const byId = new Map(tasks.map((b) => [b.id, b]));
  const epicsByStage = new Map<string, SupervisorBead[]>();
  for (const bead of tasks) {
    const stage = milestoneOf(bead);
    if (bead.issue_type !== 'epic' || stage === null) continue;
    const list = epicsByStage.get(stage) ?? [];
    list.push(bead);
    epicsByStage.set(stage, list);
  }
  const groups = new Map<string, { kind: keyof typeof GROUP_RANK; group: WaitingGroup }>();
  for (const card of cards) {
    const bead = card.node.bead;
    const stage = milestoneOf(bead);
    const parent = bead.parent ? byId.get(bead.parent) : undefined;
    let key: string;
    let kind: keyof typeof GROUP_RANK;
    let name: string;
    let subtitle: string | null = null;
    if (stage !== null) {
      key = `${MILESTONE_LABEL_PREFIX}${stage}`;
      kind = 'milestone';
      name = stage;
      const epics = epicsByStage.get(stage) ?? [];
      subtitle = epics.length === 1 ? (epics[0]?.title ?? null) : null;
    } else if (parent !== undefined && parent.issue_type === 'epic') {
      key = `epic:${parent.id}`;
      kind = 'epic';
      name = parent.title;
    } else {
      key = 'none';
      kind = 'none';
      name = t('No stage');
    }
    const entry = groups.get(key);
    if (entry) (entry.group.cards as BoardCard[]).push(card);
    else groups.set(key, { kind, group: { key, name, subtitle, cards: [card] } });
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        GROUP_RANK[a.kind] - GROUP_RANK[b.kind] ||
        a.group.name.localeCompare(b.group.name, undefined, { numeric: true }),
    )
    .map((entry) => entry.group);
}

// A task's PR when the task itself carries none (dashboard v3, never invent
// keys): the city's land bead for the task holds it. The task names its land
// bead (`devwork.land_bead`), or the land bead names its task (`land_source`,
// `gc.source_bead_id`, `devwork.task`). The number is the bead's
// `devwork.pr_number` or `pr_number`; the url passes safeExternalUrl.
const LAND_BEAD_KEY = 'devwork.land_bead';
const LAND_TASK_KEYS = ['land_source', 'gc.source_bead_id', 'devwork.task'] as const;

function prOfBead(bead: SupervisorBead): { number: string; url: string | null } | null {
  const number = meta(bead, 'devwork.pr_number') || meta(bead, 'pr_number');
  if (number.length === 0) return null;
  return { number, url: safeExternalUrl(meta(bead, 'devwork.pr_url') || meta(bead, 'pr_url')) };
}

function landPrIndex(
  tasks: readonly SupervisorBead[],
): (task: SupervisorBead) => { number: string; url: string | null } | null {
  const byId = new Map(tasks.map((b) => [b.id, b]));
  const landsOf = new Map<string, SupervisorBead[]>();
  for (const bead of tasks) {
    for (const key of LAND_TASK_KEYS) {
      const taskId = meta(bead, key);
      if (taskId.length === 0 || taskId === bead.id) continue;
      const list = landsOf.get(taskId) ?? [];
      list.push(bead);
      landsOf.set(taskId, list);
    }
  }
  return (task) => {
    const named = byId.get(meta(task, LAND_BEAD_KEY));
    for (const land of [...(named === undefined ? [] : [named]), ...(landsOf.get(task.id) ?? [])]) {
      const pr = prOfBead(land);
      if (pr !== null) return pr;
    }
    return null;
  };
}

const STAGE_ORDER = new Map(STAGES.map((stage, index) => [stage.id, index]));

/** Open cards with no PR of their own take their land bead's PR, and move to PR (I5). */
function withLandPrs(
  columns: Record<StageId, StageCard[]>,
  tasks: readonly SupervisorBead[],
): Record<StageId, StageCard[]> {
  const landPr = landPrIndex(tasks);
  const out: Record<StageId, StageCard[]> = {
    waiting: [],
    working: [],
    review: [],
    pr: [],
    merged: [],
  };
  for (const stage of STAGES) {
    for (const card of columns[stage.id]) {
      const bead = card.node.bead;
      const pr = bead.status === 'closed' || card.stage.pr !== null ? null : landPr(bead);
      if (pr === null) {
        out[stage.id].push(card);
        continue;
      }
      const target =
        (STAGE_ORDER.get(card.stage.stage) ?? 0) < (STAGE_ORDER.get('pr') ?? 3)
          ? 'pr'
          : card.stage.stage;
      out[target].push({ ...card, stage: { ...card.stage, stage: target, pr } });
    }
  }
  return out;
}

export function buildBoardModel(
  data: BoardData,
  rigs: readonly RigPrefix[],
  filters: BoardFilters,
): BoardModel {
  const tasks = data.items.filter((bead) => beadRole(bead) === 'task');
  const everything = [...tasks, ...data.routeItems, ...data.serviceItems];
  const byId = new Map(everything.map((b) => [b.id, b]));
  // Tasks only, so a card never counts route steps as its neighbours.
  const graph = buildBeadGraph(tasks);
  const routeIndex = buildRouteIndex(data.routeItems, { routesComplete: data.routesComplete });
  const stopCards = stopCardsByTask(tasks);
  const taskIds = new Set(tasks.map((b) => b.id));
  const heads = headingEpics(tasks);
  const waitersOf = buildWaitersIndex(tasks);

  // RB8: a stop card folds into its task when that task is a card.
  const cardBeads = tasks.filter((bead) => {
    if (heads.has(bead.id)) return false;
    const stops = meta(bead, STOPPED_CARD_KEY);
    return !(stops.length > 0 && bead.status !== 'closed' && taskIds.has(stops));
  });
  const nodes = cardBeads.flatMap((bead) => {
    const node = graph.nodes.get(bead.id);
    return node ? [node] : [];
  });
  const stageColumns = withLandPrs(buildStageColumns(nodes, routeIndex, stopCards), tasks);

  const prefixComplete = rigs.every((rig) => (rig.prefix?.trim() ?? '').length > 0);
  const toCard = (card: StageCard): BoardCard => {
    const bead = card.node.bead;
    return {
      ...card,
      project: prefixComplete ? projectOf(bead, rigs) : cityRef(),
      owner: DEFAULT_OWNER,
      tag: null,
      wait: cardWait(bead, card.stage, byId),
      holds: waitersOf.get(bead.id)?.length ?? 0,
      isTest: isTestBead(bead),
    };
  };
  const allCards: Record<StageId, BoardCard[]> = {
    waiting: [],
    working: [],
    review: [],
    pr: [],
    merged: [],
  };
  for (const stage of STAGES) allCards[stage.id] = stageColumns[stage.id].map(toCard);

  const activeTasks = allCards.working.length + allCards.review.length + allCards.pr.length;
  const flat = STAGES.flatMap((stage) => allCards[stage.id]);
  const testCount = flat.filter((card) => card.isTest).length;
  const visible = flat.filter((card) => filters.showTests || !card.isTest);

  // Project counts: after the test filter, before project and search.
  const counts = new Map<string, number>();
  for (const card of visible) counts.set(card.project.key, (counts.get(card.project.key) ?? 0) + 1);
  const projects: { key: string; label: string; count: number }[] = [
    { key: ALL_PROJECTS, label: t('All'), count: visible.length },
  ];
  if (prefixComplete) {
    for (const rig of rigs) {
      const count = counts.get(rig.name) ?? 0;
      if (count > 0) projects.push({ key: rig.name, label: rig.name, count });
    }
    const city = counts.get(CITY_PROJECT_KEY) ?? 0;
    if (city > 0) projects.push({ key: CITY_PROJECT_KEY, label: t('City'), count: city });
  }

  const rigsWithCards = projects.filter(
    (p) => p.key !== ALL_PROJECTS && p.key !== CITY_PROJECT_KEY,
  ).length;
  const tagOf = (card: BoardCard): string | null => {
    if (!prefixComplete || filters.project !== ALL_PROJECTS) return null;
    if (rigsWithCards >= 2) return card.project.label;
    return card.project.kind === 'city' ? card.project.label : null;
  };

  const needle = filters.search.trim().toLowerCase();
  const epic = filters.epic ?? ALL_EPICS;
  const owner = filters.owner ?? 'all';
  const matchesEpic = (bead: SupervisorBead) => {
    if (epic === ALL_EPICS) return true;
    const milestone = milestoneOf(bead);
    return epic === NO_EPIC ? milestone === null : milestone === epic;
  };
  const keep = (card: BoardCard) =>
    (filters.showTests || !card.isTest) &&
    (filters.project === ALL_PROJECTS || card.project.key === filters.project) &&
    (owner === 'all' || card.owner === owner) &&
    matchesEpic(card.node.bead) &&
    matchesSearch(card.node.bead, needle);

  const columns: Record<StageId, BoardCard[]> = {
    waiting: [],
    working: [],
    review: [],
    pr: [],
    merged: [],
  };
  for (const stage of STAGES) {
    columns[stage.id] = allCards[stage.id]
      .filter(keep)
      .map((card) => ({ ...card, tag: tagOf(card) }));
  }
  const matched = STAGES.reduce((sum, stage) => sum + columns[stage.id].length, 0);

  const liveDrainRoots = new Set(
    data.routeItems
      .filter((b) => meta(b, KIND_KEY) === 'drain' && b.status !== 'closed')
      .map((b) => meta(b, ROOT_ID_KEY)),
  );
  const orphanRuns = routeIndex
    .orphanRoots(taskIds)
    .filter((root) => !liveDrainRoots.has(root.id)).length;

  return {
    projects: projects.length > 1 ? projects : projects.slice(0, 1),
    testCount,
    columns,
    waitingGroups: groupWaiting(columns.waiting, tasks),
    foldWaiting: needle.length === 0 && columns.waiting.length > WAITING_FOLD_AT,
    idle: explainIdle(
      {
        tasks,
        routeItems: data.routeItems,
        serviceItems: data.serviceItems,
        routesComplete: data.routesComplete,
      },
      activeTasks,
    ),
    orphanRuns,
    matched,
    waitersOf,
  };
}
