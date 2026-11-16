// «Эпик: Все» + «Граф» (all-tickets graph, allm lane, 16.11). Pure: board
// beads in, every open ticket of every epic out — epics as lanes, global
// waves as shared columns, the owner's questions in one «От тебя» column.
// Waves, edge pruning, states, reasons, labels and question cards all come
// from the per-epic model (`buildGraph` with no epic = the whole board);
// this file adds lanes, collapse, cross-store gate resolution, outside
// stubs, cycle and partial-data banners, filters and lane-local rows.

import { isBoardNoise } from '../../lib/boardNoise';
import { beadRole } from '../../lib/boardRoles';
import { milestoneOf } from '../../lib/waitReasons';
import { beadIdOf, buildGraph, type GraphBead, type GraphColumn, type GraphEdge, type GraphNode } from './model';

export interface Lane {
  key: string;
  title: string;
  done: number;
  total: number;
  approved: boolean;
  collapsed: boolean;
  waitsOnEpics: string[];
  nodeIds: string[];
}
export interface BoardGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  lanes: Lane[];
  laneOf: Record<string, string>;
  columns: GraphColumn[];
  headline: string;
  subline: string;
  warnings: string[];
}
export type BoardFilter = 'all' | 'holds_me' | 'stuck' | 'in_work';
export interface BoardGraphOptions {
  nowMs: number;
  partial?: boolean;
  collapsed?: Record<string, boolean>;
  filter?: BoardFilter;
}

export const ASK_LANE = 'ask';
export const NO_EPIC_LANE = 'none';
const AUTO_COLLAPSE_ABOVE = 300;
const NON_BLOCKING = new Set(['parent-child', 'related', 'relates-to', 'discovered-from', 'duplicates', 'supersedes', 'replies-to', 'tracks']);
const ROUTE_KEYS = ['gc.kind', 'gc.root_bead_id', 'gc.cross_store_blocker', 'gc.cross_store_gate_owner'];
const APPROVED_PLAN = new Set(['admitted', 'approved', 'accepted']);
/** The old intake hold for stages without an approved executable package. */
const HOLD_PLAN = /hold:plan|нет подготовленного и принятого исполнимого пакета/u;
/** «M04 — ответ владельца на ВВ-6»: an owner-answer placeholder, not epic work (as in model.ts). */
const ANSWER_PLACEHOLDER = /(^|[\s:—–-])ответ владельца/iu;

function meta(bead: GraphBead, key: string): string {
  return bead.metadata?.[key]?.trim() ?? '';
}
const isEpic = (b: GraphBead) => b.issue_type === 'epic';
const isRoute = (b: GraphBead) => ROUTE_KEYS.some((k) => meta(b, k).length > 0);
const isGate = (b: GraphBead) => b.issue_type === 'gate';
/** A real ticket counted in its epic's progress (not plumbing, not a question gate). */
const isWork = (b: GraphBead) => !isEpic(b) && b.issue_type !== 'convoy' && !isGate(b) && !isRoute(b);

function blockerIds(bead: GraphBead): string[] {
  const out = [...(bead.needs ?? [])];
  for (const dep of bead.dependencies ?? []) if (!NON_BLOCKING.has(dep.type)) out.push(dep.depends_on_id);
  return [...new Set(out.filter((id) => id.length > 0 && id !== bead.id))];
}

/** The store prefix of a bead id («dw» of dw-3511…), '' when it has none. */
function prefixOf(id: string): string {
  const i = id.indexOf('-');
  return i > 0 ? id.slice(0, i) : '';
}

function holdsPlan(b: GraphBead): boolean {
  if ((b.labels ?? []).some((l) => l.trim() === 'hold:plan')) return true;
  return HOLD_PLAN.test(meta(b, 'devwork.intake_reason')) || HOLD_PLAN.test(meta(b, 'devwork.hold_reason'));
}

/** M00 → M14 numerically, then other milestone keys, then epics without one, «Без эпика» last. */
function laneRank(key: string, title: string): [number, number, string] {
  if (key === NO_EPIC_LANE) return [3, 0, ''];
  const m = /^M(\d+)$/u.exec(key);
  if (m !== null) return [0, Number(m[1]), key];
  if (!key.includes('-')) return [1, 0, key];
  return [2, 0, title];
}

function ruTasks(n: number): string {
  const d10 = n % 10;
  const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return `${n} задача`;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return `${n} задачи`;
  return `${n} задач`;
}
function ruQuestions(n: number): string {
  const d10 = n % 10;
  const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return `${n} вопрос`;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return `${n} вопроса`;
  return `${n} вопросов`;
}

function columnTitle(col: number, last: number): string {
  if (col === 0) return 'От тебя';
  if (col === last && last >= 3) return 'В конце';
  return ['Сейчас', 'Следом', 'Потом'][col - 1] ?? 'Ещё позже';
}

/** Strongly connected components with more than one node (Tarjan). */
function cycles(ids: readonly string[], next: Map<string, string[]>): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const on = new Set<string>();
  const out: string[][] = [];
  const strong = (v: string) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    on.add(v);
    for (const w of next.get(v) ?? []) {
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v) as number, low.get(w) as number));
      } else if (on.has(w)) {
        low.set(v, Math.min(low.get(v) as number, idx.get(w) as number));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop() as string;
        on.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) out.push(comp.reverse());
    }
  };
  for (const v of ids) if (!idx.has(v)) strong(v);
  return out;
}

function walk(start: string, next: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const stack = [...(next.get(start) ?? [])];
  while (stack.length > 0) {
    const x = stack.pop() as string;
    if (x === start || seen.has(x)) continue;
    seen.add(x);
    stack.push(...(next.get(x) ?? []));
  }
  return seen;
}

export function buildBoardGraph(beads: ReadonlyArray<GraphBead>, opts: BoardGraphOptions): BoardGraph {
  // The board's rows also carry its service beads (runtime ops, mail,
  // sessions) and alarm cards; they are never tickets. Gates stay (decision
  // gates are owner questions; route gates are dropped by buildGraph), and
  // epics stay for lane titles. A link to a dropped bead is not a blocker.
  const dropped = new Set<string>();
  const byId = new Map<string, GraphBead>();
  for (const b of beads) {
    if (typeof b?.id !== 'string' || byId.has(b.id) || dropped.has(b.id)) continue;
    const keep = isEpic(b) || isGate(b) || (beadRole(b) !== 'service' && !isBoardNoise(b));
    if (keep) byId.set(b.id, b);
    else dropped.add(b.id);
  }
  const all = [...byId.values()];
  const open = (b: GraphBead | undefined) => b !== undefined && b.status !== 'closed';

  // Lanes: the milestone label, else the parent epic (its milestone, or the
  // epic itself for «Один тип»), else «Без эпика».
  const epicTitle = new Map<string, string>();
  const epicsOfLane = new Map<string, GraphBead[]>();
  const laneKeyOf = (b: GraphBead): string => {
    const parent = b.parent ? byId.get(b.parent) : undefined;
    const parentEpic = parent !== undefined && isEpic(parent) ? parent : undefined;
    // A cross-cutting epic with no milestone («Один тип») keeps its children
    // in its own lane, whatever stage label they carry.
    if (parentEpic !== undefined && milestoneOf(parentEpic) === null) return parentEpic.id;
    const m = milestoneOf(b);
    if (m !== null) return m;
    if (parentEpic !== undefined) return milestoneOf(parentEpic) ?? parentEpic.id;
    return isEpic(b) ? b.id : NO_EPIC_LANE;
  };
  for (const e of all.filter(isEpic)) {
    const key = laneKeyOf(e);
    epicsOfLane.set(key, [...(epicsOfLane.get(key) ?? []), e]);
  }
  for (const [key, list] of epicsOfLane) {
    const best = [...list].sort((a, b) => Number(open(b)) - Number(open(a)) || a.id.localeCompare(b.id))[0] as GraphBead;
    epicTitle.set(key, best.title);
  }

  // Engine machinery is never a node: a ticket that waits on a cross-store
  // gate waits on the gate's real blocker. A blocker that is an epic becomes
  // a lane mark («ждёт M06, M07»), not lines. A blocker the board does not
  // hold becomes an outside stub.
  const realBlocker = (id: string): string => {
    const b = byId.get(id);
    const target = b === undefined ? '' : meta(b, 'gc.cross_store_blocker');
    return target.length > 0 ? target : id;
  };
  const waitsOnEpics = new Map<string, Set<string>>();
  const markEpicWait = (lane: string, epic: GraphBead) => {
    const target = laneKeyOf(epic);
    if (target === lane) return;
    waitsOnEpics.set(lane, (waitsOnEpics.get(lane) ?? new Set()).add(target));
  };
  const stubs = new Map<string, string>(); // stub id -> lane key
  const ownPrefixes = new Set([...byId.keys(), ...dropped].filter((id) => id.includes('-')).map(prefixOf));
  const input: GraphBead[] = [];
  for (const b of all) {
    const ids = blockerIds(b).map(realBlocker);
    const lane = laneKeyOf(b);
    if (isEpic(b) && open(b)) {
      for (const id of ids) {
        const t = byId.get(id);
        if (t !== undefined && open(t)) markEpicWait(lane, isEpic(t) || t.parent === undefined ? t : (byId.get(t.parent) ?? t));
      }
    }
    if (!open(b) || !isWork(b)) {
      input.push(b);
      continue;
    }
    const needs: string[] = [];
    for (const id of ids) {
      if (dropped.has(id)) continue;
      const t = byId.get(id);
      if (t !== undefined && isEpic(t)) {
        if (open(t)) markEpicWait(lane, t);
        continue;
      }
      if (t === undefined) {
        // The open read leaves closed tickets out, so an absent id of this
        // board's own store is almost always a done blocker: no wait. Another
        // store's id, or any id under partial data, is a real unknown.
        if (opts.partial !== true && ownPrefixes.has(prefixOf(id))) continue;
        if (!stubs.has(id)) stubs.set(id, lane);
      }
      needs.push(id);
    }
    input.push({ ...b, needs, dependencies: (b.dependencies ?? []).filter((d) => NON_BLOCKING.has(d.type)) });
  }
  for (const id of stubs.keys()) {
    input.push({ id, title: id, status: 'open', issue_type: 'task', created_at: new Date(opts.nowMs).toISOString() });
  }

  const model = buildGraph(input, { epicId: null, nowMs: opts.nowMs });
  const warnings: string[] = [];
  if (opts.partial === true) warnings.push('Прочитано не полностью — часть задач и связей может не попасть на граф.');

  // Lane of every node, outside stubs and partial-data states.
  const laneOf: Record<string, string> = {};
  let nodes: GraphNode[] = model.nodes.map((n) => {
    if (n.kind === 'question') {
      laneOf[n.id] = ASK_LANE;
      return { ...n };
    }
    const stubLane = stubs.get(n.id);
    if (stubLane !== undefined) {
      laneOf[n.id] = stubLane;
      return { ...n, outside: true, state: 'waits_task', reason: 'снаружи · нет на доске (закрыта, в другом риге или не прочитана)' };
    }
    laneOf[n.id] = laneKeyOf(byId.get(beadIdOf(n.id)) as GraphBead);
    if (opts.partial === true && n.state === 'nobody_took') return { ...n, state: 'free', reason: 'свободна' };
    return { ...n };
  });
  let edges = model.edges.map((e) => ({ ...e }));

  // Cycles in the data: a red banner, the layout still renders.
  const direct = new Map<string, string[]>();
  for (const b of input) if (laneOf[b.id] !== undefined) direct.set(b.id, (b.needs ?? []).filter((id) => laneOf[id] !== undefined));
  const labelOf = new Map(nodes.map((n) => [n.id, n.label]));
  for (const comp of cycles([...direct.keys()], direct)) {
    warnings.push(`цикл: ${comp.map((id) => labelOf.get(id) ?? id).join(' ⇄ ')} — поправь связь`);
  }

  // Filters.
  const filter = opts.filter ?? 'all';
  if (filter !== 'all') {
    const down = new Map<string, string[]>();
    for (const e of edges) down.set(e.from, [...(down.get(e.from) ?? []), e.to]);
    let keep: Set<string>;
    if (filter === 'holds_me') {
      keep = new Set<string>();
      for (const n of nodes) {
        if (n.kind !== 'question') continue;
        keep.add(n.id);
        for (const x of walk(n.id, down)) keep.add(x);
      }
    } else if (filter === 'in_work') {
      keep = new Set(nodes.filter((n) => n.state === 'in_work').map((n) => n.id));
    } else {
      keep = new Set(nodes.filter((n) => !n.outside && (n.state === 'nobody_took' || n.state === 'failed' || n.state === 'free')).map((n) => n.id));
    }
    nodes = nodes.filter((n) => keep.has(n.id));
    edges = edges.filter((e) => keep.has(e.from) && keep.has(e.to));
    for (const id of Object.keys(laneOf)) if (!keep.has(id)) delete laneOf[id];
  }

  // Lanes in plan order.
  const laneNodes = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    const key = laneOf[n.id] as string;
    if (key !== ASK_LANE) laneNodes.set(key, [...(laneNodes.get(key) ?? []), n]);
  }
  const progress = new Map<string, { done: number; total: number; plan: boolean }>();
  const questionBeads = new Set(model.nodes.filter((n) => n.kind === 'question' && n.id === beadIdOf(n.id)).map((n) => n.id));
  for (const b of all) {
    if (!isWork(b) || questionBeads.has(b.id) || ANSWER_PLACEHOLDER.test(b.title)) continue;
    const key = laneKeyOf(b);
    const p = progress.get(key) ?? { done: 0, total: 0, plan: false };
    p.total++;
    if (b.status === 'closed') p.done++;
    else if (holdsPlan(b)) p.plan = true;
    progress.set(key, p);
  }
  const approvedOf = (key: string): boolean => {
    if (key === NO_EPIC_LANE) return true;
    if (progress.get(key)?.plan === true) return false;
    const statuses = (epicsOfLane.get(key) ?? []).filter(open).map((e) => meta(e, 'devwork.plan_status'));
    return statuses.length === 0 || statuses.some((s) => s.length === 0 || APPROVED_PLAN.has(s));
  };
  const autoCollapse = nodes.length > AUTO_COLLAPSE_ABOVE;
  const keys = [...laneNodes.keys()];
  const titleOf = (key: string) => (key === NO_EPIC_LANE ? 'Без эпика' : (epicTitle.get(key) ?? key));
  keys.sort((a, b) => {
    const ra = laneRank(a, titleOf(a));
    const rb = laneRank(b, titleOf(b));
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2].localeCompare(rb[2], 'ru');
  });
  const laneIndex = new Map(keys.map((k, i) => [k, i]));
  const lanes: Lane[] = keys.map((key) => {
    const approved = approvedOf(key);
    const p = progress.get(key) ?? { done: 0, total: 0 };
    const waits = [...(waitsOnEpics.get(key) ?? [])].sort((a, b) => (laneRank(a, a)[1] - laneRank(b, b)[1]) || a.localeCompare(b));
    return {
      key,
      title: titleOf(key),
      done: p.done,
      total: p.total,
      approved,
      collapsed: opts.collapsed?.[key] ?? (autoCollapse || !approved),
      waitsOnEpics: waits,
      nodeIds: (laneNodes.get(key) ?? []).map((n) => n.id),
    };
  });
  const collapsedLane = new Set(lanes.filter((l) => l.collapsed).map((l) => l.key));

  // Compress empty wave gaps over what is on screen (questions and expanded
  // lanes); a collapsed lane's tickets map onto the nearest visible wave.
  const visibleCols = [...new Set(nodes.filter((n) => n.kind === 'task' && !collapsedLane.has(laneOf[n.id] as string)).map((n) => n.column))].sort((a, b) => a - b);
  const allCols = [...new Set(nodes.filter((n) => n.kind === 'task').map((n) => n.column))].sort((a, b) => a - b);
  const basis = visibleCols.length > 0 ? visibleCols : allCols;
  const remap = (c: number) => Math.max(1, basis.filter((v) => v <= c).length);
  for (const n of nodes) n.column = n.kind === 'question' ? 0 : remap(n.column);

  // Rows inside a lane: wave 1 by holds, later waves and questions by the
  // barycentre of their neighbours' board position (lane, then row).
  const pos = new Map<string, number>();
  const ROW_SPAN = 10_000;
  const posOf = (n: GraphNode) => (n.kind === 'question' ? -1 : (laneIndex.get(laneOf[n.id] as string) ?? 0) * ROW_SPAN + n.row);
  const upAdj = new Map<string, string[]>();
  const downAdj = new Map<string, string[]>();
  for (const e of edges) {
    upAdj.set(e.to, [...(upAdj.get(e.to) ?? []), e.from]);
    downAdj.set(e.from, [...(downAdj.get(e.from) ?? []), e.to]);
  }
  const bary = (ids: readonly string[]) => {
    const ps = ids.map((x) => pos.get(x)).filter((p): p is number => p !== undefined && p >= 0);
    return ps.length === 0 ? Number.POSITIVE_INFINITY : ps.reduce((s, p) => s + p, 0) / ps.length;
  };
  const byLabel = (a: GraphNode, b: GraphNode) => a.label.localeCompare(b.label, 'ru') || a.id.localeCompare(b.id);
  const lastCol = Math.max(1, ...nodes.map((n) => n.column));
  for (let c = 1; c <= lastCol; c++) {
    for (const key of keys) {
      const list = nodes.filter((n) => n.column === c && laneOf[n.id] === key);
      const sorted =
        c === 1
          ? list.sort((a, b) => b.holds - a.holds || byLabel(a, b))
          : list.map((n) => ({ n, k: bary(upAdj.get(n.id) ?? []) })).sort((a, b) => a.k - b.k || byLabel(a.n, b.n)).map((x) => x.n);
      sorted.forEach((n, i) => {
        n.row = i;
        pos.set(n.id, posOf(n));
      });
    }
  }
  nodes
    .filter((n) => n.kind === 'question')
    .map((n) => ({ n, k: bary(downAdj.get(n.id) ?? []) }))
    .sort((a, b) => a.k - b.k || byLabel(a.n, b.n))
    .forEach((x, i) => (x.n.row = i));
  nodes.sort(
    (a, b) =>
      a.column - b.column ||
      (laneIndex.get(laneOf[a.id] as string) ?? -1) - (laneIndex.get(laneOf[b.id] as string) ?? -1) ||
      a.row - b.row,
  );

  // Column headers.
  const columns: GraphColumn[] = [];
  for (let c = 0; c <= lastCol; c++) {
    const list = nodes.filter((n) => n.column === c && (c === 0 || !collapsedLane.has(laneOf[n.id] as string)));
    const alarm = list.some((n) => n.state === 'nobody_took' || n.state === 'failed');
    let verdict: string;
    if (c === 0) {
      const top = [...list].sort((a, b) => b.holds - a.holds || byLabel(a, b))[0];
      verdict = top === undefined ? 'вопросов нет' : `${ruQuestions(list.length)} · больше всех держит ${top.label.replace(/^вопрос · /u, '')}`;
    } else if (c === 1) {
      const working = list.filter((n) => n.state === 'in_work').length;
      const owner = list.filter((n) => n.state === 'waits_owner').length;
      const idle = list.filter((n) => n.state === 'nobody_took').length;
      const parts = [`в работе ${working} из ${list.length}`];
      if (owner > 0) parts.push(owner === 1 ? '1 ждёт твоего ответа' : `${owner} ждут твоих ответов`);
      if (idle > 0) parts.push(`${idle} никто не взял`);
      verdict = parts.join(' · ');
    } else {
      verdict = c === lastCol && lastCol >= 3 ? 'ждёт всё, что левее' : 'ждут предыдущих';
    }
    columns.push({ title: columnTitle(c, lastCol), count: list.length, verdict, alarm });
  }

  // Headline and subline over the whole board.
  const tasks = nodes.filter((n) => n.kind === 'task' && !n.outside);
  const questions = nodes.filter((n) => n.kind === 'question');
  const drafts = lanes.filter((l) => !l.approved).length;
  const top = [...tasks].sort((a, b) => b.holds - a.holds || byLabel(a, b))[0];
  const topQ = [...questions].sort((a, b) => b.holds - a.holds || byLabel(a, b))[0];
  const headline = [
    `Открыто ${ruTasks(tasks.length)} в ${lanes.length} этапах`,
    drafts > 0 ? `${drafts} без одобренного плана` : '',
    topQ !== undefined && topQ.holds > 0 ? `больше всех держит ${topQ.label.replace(/^вопрос · /u, '')}: ждут ${topQ.holds}` : top !== undefined && top.holds > 0 ? `больше всех держит ${top.label}: ждут ${top.holds}` : '',
  ]
    .filter((s) => s.length > 0)
    .join(' · ')
    .concat('.');
  const idle = tasks.filter((n) => n.state === 'nobody_took').length;
  const subline =
    opts.partial === true
      ? 'Данные прочитаны не полностью: кто ничего не ждёт, может ждать то, что не прочитано.'
      : idle > 0
        ? `Без причины ${idle === 1 ? 'стоит' : 'стоят'} ${idle}: никто не взял.`
        : questions.length > 0
          ? 'Без причины не стоит ничего: что не в работе, ждёт других задач или твоих ответов — они слева, в колонке «От тебя».'
          : 'Без причины не стоит ничего.';

  return { nodes, edges, lanes, laneOf, columns, headline, subline, warnings };
}
