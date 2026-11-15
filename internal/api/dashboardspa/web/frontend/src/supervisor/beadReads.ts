import type {
  Bead,
  GetV0CityByCityNameBeadsData,
  ListBodyBead,
} from 'gas-city-dashboard-shared/gc-supervisor';
import { activeCityOrThrow } from '../api/cityBase';
import { isRouteBead } from '../lib/stageBoard';
import { SupervisorApiError, supervisorApi } from './client';
import { listSupervisorRigs } from './rigReads';

export type SupervisorBead = Bead;

export interface SupervisorBeadList extends Omit<ListBodyBead, 'items' | 'total'> {
  items: SupervisorBead[];
  total: number;
  upstream_total?: number;
  upstream_fetched: number;
  fetch_limit: number;
  /** With `withRoutes`: workflow roots and their members (any type), split off `items`. */
  route_items?: SupervisorBead[];
  /** With `withRoutes`: false when the leg that supplied the routes was truncated. */
  routes_complete?: boolean;
  /** With `recentClosed`: beads the rig-scoped closed legs returned. */
  recent_closed_fetched?: number;
}

export interface ListSupervisorBeadsOptions {
  includeClosed?: boolean;
  includeBookkeeping?: boolean;
  rigFilter?: string;
  limit?: number;
  city?: string;
  signal?: AbortSignal;
  /**
   * Stage board: move route beads (gc.kind=workflow roots and gc.root_bead_id
   * members, of every type, gates included) out of `items` into `route_items`,
   * so they fold into their task instead of flooding the board.
   */
  withRoutes?: boolean;
  /**
   * Stage board: when closed beads are not already included, add one
   * best-effort `status=closed&rig=<rig>` leg per rig (the rig filter, else
   * every supervisor rig). Rig stores hold the product tasks; the unscoped
   * closed window is all route-step churn from the city store, so it cannot
   * surface recent merges.
   */
  recentClosed?: { limit: number };
}

// Pre-exposure load bounds (gascity-dashboard-q89b): board and detail-fallback
// list fetches run per client, so keep them modest. Truncation degrades
// visibly: upstream_total vs fetch_limit feeds the board's truncation notice.
const BEADS_FETCH_LIMIT = 1000;
const ASSIGNED_BEADS_FETCH_LIMIT = 200;
const DETAIL_FALLBACK_FETCH_LIMIT = 1000;
// The "real work" bead types the board fans out (one typed query each),
// then keeps via defaultBeadFilter — the bookkeeping types
// (message/session/molecule/…) are dropped. Every entry MUST be a type the
// live gc/bd backend accepts as a `type=` filter: a rig-scoped include-closed
// (`all=true`) query for a type the backend rejects fails closed (HTTP 503
// "invalid issue type") and that one rejected leg blanks the whole board.
const ENGINEERING_BEAD_TYPES: ReadonlySet<string> = new Set([
  'feature',
  'bug',
  'task',
  'epic',
  'chore',
  'decision',
]);

export async function listSupervisorBeads(
  options: ListSupervisorBeadsOptions = {},
): Promise<SupervisorBeadList> {
  const cityName = options.city ?? activeCityOrThrow('list supervisor beads');
  const limit = options.limit ?? BEADS_FETCH_LIMIT;
  const rigFilter = options.rigFilter?.trim() ?? '';
  const includeClosed = options.includeClosed ?? false;
  const includeBookkeeping = options.includeBookkeeping ?? false;
  const baseQuery: NonNullable<GetV0CityByCityNameBeadsData['query']> = {
    limit,
    ...(includeClosed ? { all: true } : {}),
    ...(rigFilter.length === 0 ? {} : { rig: rigFilter }),
  };
  // The windowed list is newest-created-first, so long-running in-progress work
  // ages out of it — exactly the beads an operator most needs to see (gp-6xd
  // F1: 7 of 9 in-progress beads sat past the window). A second, dedicated
  // status=in_progress leg fetches that set whole — it is tiny by definition —
  // and merges into the window. Best-effort: if the leg fails, the board
  // degrades to the window (with its truncation notice) instead of blanking.
  const inProgressQuery: NonNullable<GetV0CityByCityNameBeadsData['query']> = {
    limit,
    status: 'in_progress',
    ...(rigFilter.length === 0 ? {} : { rig: rigFilter }),
  };
  const listWith = (query: NonNullable<GetV0CityByCityNameBeadsData['query']>) =>
    options.signal === undefined
      ? supervisorApi().listBeads(cityName, query)
      : supervisorApi().listBeads(cityName, query, options.signal);
  const recentClosedLegs =
    options.recentClosed !== undefined && !includeClosed
      ? recentClosedRigs(rigFilter).then((rigs) =>
          Promise.all(
            rigs.map((rig) =>
              listWith({ limit: options.recentClosed?.limit ?? 0, status: 'closed', rig })
                .then((leg) => leg.items ?? [])
                .catch(() => [] as SupervisorBead[]),
            ),
          ),
        )
      : Promise.resolve(null);
  // Run roots and steps live in the city graph store. A rig-scoped read hits
  // the rig's work store alone (engine storeref.WorkScope), so with a rig
  // filter the routes come from one unscoped open leg, used for route_items
  // only (review I1).
  const wantsRouteLeg = options.withRoutes === true && rigFilter.length > 0;
  // Best-effort: a failed route leg leaves cards on their status fallback and
  // reports routes as incomplete, so nothing is read as a stopped run.
  const routeLeg = wantsRouteLeg ? listWith({ limit }).catch(() => null) : Promise.resolve(null);
  const [list, inProgress, closedLegs, routeList] = await Promise.all([
    listWith(baseQuery),
    listWith(inProgressQuery).catch(() => null),
    recentClosedLegs.catch(() => null),
    routeLeg,
  ]);
  const windowItems = uniqueById(list.items ?? []);
  const items = uniqueById([...windowItems, ...(inProgress?.items ?? [])]);
  const statusFiltered = includeClosed ? items : items.filter((bead) => bead.status !== 'closed');
  const recentClosed = uniqueById((closedLegs ?? []).flat()).filter(
    (bead) => bead.status === 'closed' && !items.some((item) => item.id === bead.id),
  );
  const scoped = [...statusFiltered, ...recentClosed];
  const routeItems = options.withRoutes
    ? uniqueById([...scoped, ...(routeList?.items ?? [])].filter(isRouteBead))
    : undefined;
  const boardScoped = options.withRoutes ? scoped.filter((bead) => !isRouteBead(bead)) : scoped;
  const filtered = includeBookkeeping ? boardScoped : boardScoped.filter(defaultBeadFilter);
  const upstreamTotal = countAsNumber(list.total);
  // Whether the leg that supplied the routes held every bead it matched: only
  // then may the board read "no live run" as "its run stopped".
  const routeSource = wantsRouteLeg ? routeList : list;
  const routeSourceTotal = routeSource === null ? undefined : countAsNumber(routeSource.total);
  const routesComplete =
    routeSource !== null &&
    (routeSourceTotal === undefined || (routeSource.items ?? []).length >= routeSourceTotal);
  return {
    items: filtered,
    total: filtered.length,
    ...(routeItems === undefined
      ? {}
      : { route_items: routeItems, routes_complete: routesComplete }),
    ...(closedLegs === null ? {} : { recent_closed_fetched: recentClosed.length }),
    ...(upstreamTotal === undefined ? {} : { upstream_total: upstreamTotal }),
    // Counted from the WINDOW leg alone, against which `upstream_total` is
    // reported. Counting the merged array would let beads recovered by the
    // in-progress leg pad the figure past the window size and silence the
    // truncation notice precisely when window beads really were dropped.
    upstream_fetched: windowItems.length,
    fetch_limit: limit,
  };
}

export async function listSupervisorBeadsAssignedTo(
  assignees: readonly string[],
  options: Pick<ListSupervisorBeadsOptions, 'includeClosed' | 'limit'> = {},
): Promise<SupervisorBeadList> {
  const cityName = activeCityOrThrow('list supervisor assigned beads');
  const uniqueAssignees = uniqueNonEmpty(assignees);
  const limit = options.limit ?? ASSIGNED_BEADS_FETCH_LIMIT;
  const includeClosed = options.includeClosed ?? false;
  if (uniqueAssignees.length === 0) {
    return {
      items: [],
      total: 0,
      upstream_fetched: 0,
      fetch_limit: limit,
    };
  }
  const lists = await Promise.all(
    uniqueAssignees.map((assignee) =>
      supervisorApi().listBeads(cityName, {
        assignee,
        limit,
        ...(includeClosed ? { all: true } : {}),
      }),
    ),
  );
  const items = uniqueById(lists.flatMap((list) => list.items ?? []));
  const upstreamTotal = sumTotals(lists);
  return {
    items,
    total: items.length,
    ...(upstreamTotal === undefined ? {} : { upstream_total: upstreamTotal }),
    upstream_fetched: items.length,
    fetch_limit: limit,
  };
}

export async function fetchSupervisorBead(id: string): Promise<SupervisorBead> {
  const cityName = activeCityOrThrow('fetch supervisor bead');
  try {
    return await supervisorApi().getBead(cityName, id);
  } catch (err) {
    if (!(err instanceof SupervisorApiError) || err.status !== 404) throw err;

    const list = await supervisorApi().listBeads(cityName, {
      limit: DETAIL_FALLBACK_FETCH_LIMIT,
    });
    const hit = (list.items ?? []).find((bead) => bead.id === id);
    if (hit !== undefined) return hit;
    throw err;
  }
}

async function recentClosedRigs(rigFilter: string): Promise<string[]> {
  if (rigFilter.length > 0) return [rigFilter];
  const rigs = await listSupervisorRigs();
  return uniqueNonEmpty(rigs.items.map((rig) => rig.name));
}

function defaultBeadFilter(bead: SupervisorBead): boolean {
  if (!ENGINEERING_BEAD_TYPES.has(bead.issue_type)) return false;
  if (Array.isArray(bead.labels) && bead.labels.some((label) => label.startsWith('gc:'))) {
    return false;
  }
  return true;
}
function countAsNumber(value: ListBodyBead['total']): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return undefined;
}

function sumTotals(lists: readonly ListBodyBead[]): number | undefined {
  let total = 0;
  for (const list of lists) {
    const value = countAsNumber(list.total);
    if (value === undefined) return undefined;
    total += value;
  }
  return total;
}

function uniqueById(items: readonly SupervisorBead[]): SupervisorBead[] {
  const seen = new Set<string>();
  const unique: SupervisorBead[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
  }
  return unique;
}
