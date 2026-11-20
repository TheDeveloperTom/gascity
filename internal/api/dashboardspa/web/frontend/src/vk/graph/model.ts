// «Граф» tab, model lane (16.11 graph sprint). Pure: board beads in, the
// epic's dependency graph out — waves by longest path, transitively redundant
// edges pruned, Russian states, reasons and verdicts as on the approved
// mockups (scratchpad/design-board/project/Graph-*.dc.html). The wave and
// pruning logic is a port of the mockup generator graph-gen/gen.py
// (`depth`, `reduced_edges`).
//
// Data: the board's SupervisorBead (routes/Beads.tsx). A bead's blockers are
// its `needs` plus its blocking `dependencies[]` (lib/beadGraph.ts reads the
// same two fields). Owner questions are open beads marked for the owner
// (`needs/operator`, a Mayor decision) or open human gates.

import type { SupervisorBead } from '../../supervisor/beadReads';
import { milestoneOf } from '../../lib/waitReasons';
import { ownerDebtIndex, ownerDebtOf, type OwnerQuestion } from '../../lib/ownerQuestions';
import { cardLabel } from '../board/cardLabel';
import { cityStepOf, type CityStep } from './planStep';

/** The bead element the graph reads: exactly what the board loads. */
export type GraphBead = SupervisorBead;

export type GraphNodeKind = 'question' | 'task';
export type GraphNodeState = 'in_work' | 'waits_owner' | 'waits_task' | 'free' | 'nobody_took' | 'failed' | 'done';
export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  title: string;
  state: GraphNodeState;
  reason: string;
  holds: number;
  column: number;
  row: number;
  outside: boolean;
  assignee: string | null;
}
export interface GraphEdge {
  from: string;
  to: string;
}
export interface GraphColumn {
  title: string;
  count: number;
  verdict: string;
  alarm: boolean;
}
export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  columns: GraphColumn[];
  headline: string;
  subline: string;
}
export interface Chain {
  up: Set<string>;
  down: Set<string>;
  downNow: Set<string>;
}

const DAY_MS = 86_400_000;
/** Dependency types that do not block (shown elsewhere, never a wait). */
const NON_BLOCKING = new Set(['parent-child', 'related', 'relates-to', 'discovered-from', 'duplicates', 'supersedes', 'replies-to', 'tracks']);
const VV = /ВВ-\d+/u;
const SHORT_MAX = 28;

function isBead(value: unknown): value is GraphBead {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && v.id.length > 0 && typeof v.title === 'string' && typeof v.status === 'string';
}

function meta(bead: GraphBead, key: string): string {
  return bead.metadata?.[key]?.trim() ?? '';
}

/** Route roots/steps, drains and cross-store gates carry these; real tasks carry other gc.* keys. */
function isRouteBead(bead: GraphBead): boolean {
  return ['gc.kind', 'gc.root_bead_id', 'gc.cross_store_blocker', 'gc.cross_store_gate_owner'].some((k) => meta(bead, k).length > 0);
}

/**
 * What a bead is on the graph. One rule for the owner (DIAG-board-vs-needs-you
 * 20.11): a question card in «От тебя» is exactly lib/ownerQuestions
 * ownerDebtOf — an open human gate with a question posted, or the plain-card
 * fallback (a card carrying its own posted question, no answer gate) — the same rule
 * «Нужно от меня» counts. An open gate the city still works on (a plan «да»
 * nobody asked yet, planStep.ts) is an ordinary step. Everything else that is
 * a gate, a route bead, an epic or a convoy is plumbing; agents' session waits
 * (`gc:wait`) are plumbing too.
 */
interface Classifier {
  debt: (bead: GraphBead) => OwnerQuestion | null;
  step: (bead: GraphBead) => CityStep | null;
  plumbing: (bead: GraphBead) => boolean;
}

function classifier(all: ReadonlyArray<GraphBead>): Classifier {
  const index = ownerDebtIndex(all);
  const debts = new Map<string, OwnerQuestion | null>();
  const steps = new Map<string, CityStep | null>();
  const debt = (b: GraphBead) => {
    if (!debts.has(b.id)) debts.set(b.id, ownerDebtOf(b, index));
    return debts.get(b.id) ?? null;
  };
  const step = (b: GraphBead) => {
    if (!steps.has(b.id)) steps.set(b.id, debt(b) === null ? cityStepOf(b, index, all) : null);
    return steps.get(b.id) ?? null;
  };
  const plumbing = (b: GraphBead) => {
    if (b.issue_type === 'epic' || b.issue_type === 'convoy') return true;
    if (debt(b) !== null || step(b) !== null) return false;
    return b.issue_type === 'gate' || isRouteBead(b);
  };
  return { debt, step, plumbing };
}

/** An in-work, non-gate card that is itself the owner's debt: shown as task + its own question card. */
function ownQuestionCard(bead: GraphBead, cls: Classifier): boolean {
  return bead.issue_type !== 'gate' && bead.status === 'in_progress' && cls.debt(bead) !== null;
}

const QUESTION_SUFFIX = '::q';
/** Node id of the question card that lives on task `beadId`. */
export function questionNodeId(beadId: string): string {
  return `${beadId}${QUESTION_SUFFIX}`;
}
/** The bead a node stands for (a task's own question card → that task). */
export function beadIdOf(nodeId: string): string {
  return nodeId.endsWith(QUESTION_SUFFIX) ? nodeId.slice(0, -QUESTION_SUFFIX.length) : nodeId;
}

function blockerIds(bead: GraphBead): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (id.length === 0 || id === bead.id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  for (const id of bead.needs ?? []) add(id);
  for (const dep of bead.dependencies ?? []) {
    if (!NON_BLOCKING.has(dep.type)) add(dep.depends_on_id);
  }
  return out;
}

function shorten(text: string): string {
  const t = text.trim();
  return t.length > SHORT_MAX ? `${t.slice(0, SHORT_MAX - 1)}…` : t;
}

function ruQuestions(n: number): string {
  const d10 = n % 10;
  const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return `${n} вопрос`;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return `${n} вопроса`;
  return `${n} вопросов`;
}

function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} и ${items[items.length - 1]}`;
}

function listShort(items: readonly string[], max = 2): string {
  return items.length <= max ? items.join(', ') : `${items.slice(0, max).join(', ')} +${items.length - max}`;
}

interface Draft {
  bead: GraphBead;
  kind: GraphNodeKind;
  label: string;
  title: string;
  /** Short name of a question («ВВ-4»), else the label. */
  short: string;
  outside: boolean;
  blockers: string[];
  /** Set on a gate the city still works on: its status line. */
  step?: CityStep;
}

function draftOf(
  bead: GraphBead,
  byId: Map<string, GraphBead>,
  cls: Classifier,
  outside: boolean,
  blockers: string[],
): Draft {
  const parent = bead.parent ? byId.get(bead.parent) : undefined;
  const epicTitle = parent !== undefined && parent.issue_type === 'epic' ? parent.title : null;
  const debt = cls.debt(bead);
  // An in-work card stays a task; its own question becomes a separate card (below).
  if (debt !== null && !ownQuestionCard(bead, cls)) {
    // An answer gate shows the question of the card it holds.
    const derived = cardLabel({ title: debt.title, milestone: milestoneOf(bead), epicTitle, id: bead.id });
    const vv = VV.exec(derived.label ?? '') ?? VV.exec(debt.title) ?? VV.exec(debt.question);
    const short = vv !== null ? vv[0] : shorten(derived.title);
    return { bead, kind: 'question', label: `вопрос · ${short}`, title: derived.title, short, outside: false, blockers };
  }
  const step = cls.step(bead);
  if (step !== null) {
    return { bead, kind: 'task', label: step.label, title: bead.title, short: step.label, outside, blockers, step };
  }
  const derived = cardLabel({ title: bead.title, milestone: milestoneOf(bead), epicTitle, id: bead.id });
  const label = derived.label ?? shorten(derived.title);
  return { bead, kind: 'task', label, title: derived.title, short: label, outside, blockers };
}

/** Port of gen.py `reduced_edges`: drop d→n when n still reaches d without it. */
function reducedEdges(order: readonly string[], direct: Map<string, string[]>): GraphEdge[] {
  const reach = (from: string, target: string, skip: string): boolean => {
    const stack = (direct.get(from) ?? []).filter((d) => d !== skip);
    const seen = new Set<string>();
    while (stack.length > 0) {
      const x = stack.pop() as string;
      if (x === target) return true;
      if (seen.has(x)) continue;
      seen.add(x);
      stack.push(...(direct.get(x) ?? []));
    }
    return false;
  };
  const edges: GraphEdge[] = [];
  for (const n of order) {
    for (const d of direct.get(n) ?? []) {
      if (!reach(n, d, d)) edges.push({ from: d, to: n });
    }
  }
  return edges;
}

/** Port of gen.py `depth`: 1 + longest blocker path; cycles cut. */
function depths(order: readonly string[], direct: Map<string, string[]>): Map<string, number> {
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const f = (n: string): number => {
    const known = memo.get(n);
    if (known !== undefined) return known;
    if (visiting.has(n)) return 0;
    visiting.add(n);
    let best = 0;
    for (const d of direct.get(n) ?? []) best = Math.max(best, f(d));
    visiting.delete(n);
    memo.set(n, best + 1);
    return best + 1;
  };
  for (const n of order) f(n);
  return memo;
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

function columnTitle(col: number, last: number): string {
  if (col === 0) return 'От тебя';
  if (col === last && last >= 3) return 'В конце';
  return ['Сейчас', 'Следом', 'Потом'][col - 1] ?? 'Ещё позже';
}

export function buildGraph(
  beads: ReadonlyArray<unknown>,
  opts: { epicId: string | null; focusIds?: string[]; nowMs: number; partial?: boolean },
): GraphModel {
  const all = beads.filter(isBead);
  const byId = new Map<string, GraphBead>();
  for (const b of all) if (!byId.has(b.id)) byId.set(b.id, b);
  const cls = classifier([...byId.values()]);
  const live = (id: string): GraphBead | undefined => {
    const b = byId.get(id);
    return b !== undefined && b.status !== 'closed' && !cls.plumbing(b) ? b : undefined;
  };
  const liveBlockers = (b: GraphBead) => blockerIds(b).filter((id) => live(id) !== undefined);
  // The epic is a milestone key («M04», the board's epic filter) or an epic bead id.
  const epicBead = opts.epicId === null ? undefined : byId.get(opts.epicId);
  const epicIsBead = epicBead !== undefined && epicBead.issue_type === 'epic';
  const epicKey = epicIsBead ? milestoneOf(epicBead) : opts.epicId;
  const inEpicOf = (b: GraphBead) =>
    opts.epicId === null || (epicKey !== null && milestoneOf(b) === epicKey) || (epicIsBead && b.parent === opts.epicId);

  // Membership: the focus chains, else the epic's open tasks plus every open
  // ancestor (outside blockers and the owner questions behind them).
  const members: string[] = [];
  const inSet = new Set<string>();
  const push = (id: string) => {
    if (!inSet.has(id) && live(id) !== undefined) {
      inSet.add(id);
      members.push(id);
    }
  };
  const focus = (opts.focusIds ?? []).filter((id) => live(id) !== undefined);
  if (focus.length > 0) {
    const up = new Map<string, string[]>();
    const down = new Map<string, string[]>();
    for (const b of all) {
      if (live(b.id) === undefined) continue;
      for (const d of liveBlockers(b)) {
        up.set(b.id, [...(up.get(b.id) ?? []), d]);
        down.set(d, [...(down.get(d) ?? []), b.id]);
      }
    }
    for (const f of focus) {
      push(f);
      for (const id of walk(f, up)) push(id);
      for (const id of walk(f, down)) push(id);
    }
  } else {
    for (const b of all) {
      if (live(b.id) === undefined) continue;
      if (inEpicOf(b)) push(b.id);
    }
    for (let i = 0; i < members.length; i++) {
      const b = byId.get(members[i] as string) as GraphBead;
      for (const d of liveBlockers(b)) push(d);
    }
  }

  const inEpic = (b: GraphBead) => focus.length > 0 || inEpicOf(b);
  const drafts = new Map<string, Draft>();
  for (const id of members) {
    const b = byId.get(id) as GraphBead;
    drafts.set(id, draftOf(b, byId, cls, !inEpic(b), liveBlockers(b).filter((d) => inSet.has(d))));
  }
  // A card in work that carries the owner's open question itself (the
  // plain-card fallback: no answer gate yet) gets a separate question card that
  // blocks it. With an answer gate, that gate is the question node instead.
  for (const id of [...members]) {
    const task = drafts.get(id) as Draft;
    if (!ownQuestionCard(task.bead, cls)) continue;
    const q = cls.debt(task.bead) as OwnerQuestion;
    const vv = VV.exec(q.question) ?? VV.exec(task.bead.title) ?? VV.exec(task.label);
    const short = vv !== null ? vv[0] : shorten(q.question);
    const qid = questionNodeId(id);
    const title = q.question.charAt(0).toLocaleUpperCase('ru') + q.question.slice(1);
    drafts.set(qid, { bead: task.bead, kind: 'question', label: `вопрос · ${short}`, title, short, outside: false, blockers: [] });
    task.blockers = [qid, ...task.blockers];
    members.push(qid);
    inSet.add(qid);
  }
  const direct = new Map<string, string[]>();
  for (const [id, d] of drafts) direct.set(id, d.blockers);
  const edges = reducedEdges(members, direct);

  const downAdj = new Map<string, string[]>();
  for (const e of edges) downAdj.set(e.from, [...(downAdj.get(e.from) ?? []), e.to]);
  const holdsOf = (id: string) => [...walk(id, downAdj)].filter((x) => drafts.get(x)?.kind === 'task').length;

  // Waves: questions in column 0; tasks by longest path over task blockers.
  const taskDirect = new Map<string, string[]>();
  for (const [id, d] of drafts) {
    if (d.kind === 'task') taskDirect.set(id, d.blockers.filter((x) => drafts.get(x)?.kind === 'task'));
  }
  const taskIds = members.filter((id) => drafts.get(id)?.kind === 'task');
  const depth = depths(taskIds, taskDirect);

  const shortOf = (id: string) => drafts.get(id)?.short ?? id;
  const nodes: GraphNode[] = members.map((id) => {
    const d = drafts.get(id) as Draft;
    const b = d.bead;
    const holds = holdsOf(id);
    const assignee = d.kind === 'task' && b.assignee && b.assignee.trim().length > 0 ? b.assignee.trim() : null;
    const base = { id, kind: d.kind, label: d.label, title: d.title, holds, row: 0, outside: d.outside, assignee };
    if (d.kind === 'question') {
      return { ...base, column: 0, state: 'waits_owner', reason: `держит ${holds}` };
    }
    const column = depth.get(id) ?? 1;
    const qs = d.blockers.filter((x) => drafts.get(x)?.kind === 'question').map(shortOf);
    const ts = d.blockers.filter((x) => drafts.get(x)?.kind === 'task').map(shortOf);
    let state: GraphNodeState;
    let reason: string;
    if (d.step !== undefined) {
      // The city's own step (a plan being written, reviewed, about to be asked).
      state = 'waits_task';
      reason = d.step.reason;
    } else if (b.status === 'in_progress') {
      state = 'in_work';
      reason = qs.length > 0 ? `ждёт тебя: ${listShort(qs)}` : 'в работе';
    } else if (b.status === 'failed') {
      state = 'failed';
      reason = 'упала';
    } else if (qs.length > 0) {
      state = 'waits_owner';
      reason = `ждёт тебя: ${listShort(qs)}`;
    } else if (ts.length > 0) {
      state = 'waits_task';
      reason = `ждёт: ${listShort(ts)}`;
    } else {
      const since = Date.parse(b.updated_at ?? b.created_at);
      const days = Number.isFinite(since) ? Math.floor((opts.nowMs - since) / DAY_MS) : 0;
      if (assignee === null && days >= 1 && opts.partial !== true) {
        state = 'nobody_took';
        reason = `никто не взял · ${days} дн`;
      } else {
        state = 'free';
        reason = assignee === null ? 'свободна' : 'назначена, ещё не начата';
      }
    }
    return { ...base, column, state, reason };
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // Rows: «Сейчас» by holds; later waves by the barycentre of their
  // blockers; questions by the barycentre of what they hold.
  const lastCol = Math.max(1, ...nodes.map((n) => n.column));
  const byLabel = (a: GraphNode, b: GraphNode) => a.label.localeCompare(b.label, 'ru') || a.id.localeCompare(b.id);
  const upAdj = new Map<string, string[]>();
  for (const e of edges) upAdj.set(e.to, [...(upAdj.get(e.to) ?? []), e.from]);
  const bary = (ids: readonly string[]) => {
    const rows = ids.map((x) => nodeById.get(x)?.row).filter((r): r is number => r !== undefined);
    return rows.length === 0 ? Number.POSITIVE_INFINITY : rows.reduce((s, r) => s + r, 0) / rows.length;
  };
  const setRows = (list: GraphNode[]) => list.forEach((n, i) => (n.row = i));
  const colOf = (c: number) => nodes.filter((n) => n.column === c);
  setRows(colOf(1).sort((a, b) => b.holds - a.holds || byLabel(a, b)));
  for (let c = 2; c <= lastCol; c++) {
    const list = colOf(c).map((n) => ({ n, k: bary(upAdj.get(n.id) ?? []) }));
    setRows(list.sort((a, b) => a.k - b.k || byLabel(a.n, b.n)).map((x) => x.n));
  }
  const q0 = colOf(0).map((n) => ({ n, k: bary(downAdj.get(n.id) ?? []) }));
  setRows(q0.sort((a, b) => a.k - b.k || byLabel(a.n, b.n)).map((x) => x.n));
  nodes.sort((a, b) => a.column - b.column || a.row - b.row);

  // Column headers and verdicts.
  const columns: GraphColumn[] = [];
  for (let c = 0; c <= lastCol; c++) {
    const list = colOf(c);
    const alarm = list.some((n) => n.state === 'nobody_took' || n.state === 'failed');
    let verdict: string;
    if (c === 0) {
      const top = [...list].sort((a, b) => b.holds - a.holds || byLabel(a, b))[0];
      verdict = top === undefined ? 'вопросов нет' : `${ruQuestions(list.length)} · больше всех держит ${shortOf(top.id)}`;
    } else if (c === 1) {
      const working = list.filter((n) => n.state === 'in_work').length;
      const owner = list.filter((n) => n.state === 'waits_owner').length;
      const idle = list.filter((n) => n.state === 'nobody_took').length;
      const parts = [`в работе ${working} из ${list.length}`];
      if (owner > 0) parts.push(owner === 1 ? '1 ждёт твоего ответа' : `${owner} ждут твоих ответов`);
      if (idle > 0) parts.push(`${idle} никто не взял`);
      verdict = parts.join(' · ');
    } else if (c === lastCol && lastCol >= 3) {
      const acc = list.length === 1 && /приёмк/iu.test(`${list[0]?.label} ${list[0]?.title}`);
      verdict = acc ? 'приёмка ждёт всё, что левее' : 'ждёт всё, что левее';
    } else {
      const sets = list.map((n) => (upAdj.get(n.id) ?? []).join('|'));
      const same = sets.every((s) => s === sets[0]);
      const blockers = (upAdj.get(list[0]?.id ?? '') ?? []).map(shortOf);
      if (same && blockers.length > 0) {
        verdict = list.length > 1 ? `${list.length} пойдут параллельно после ${joinAnd(blockers)}` : `ждёт ${joinAnd(blockers)}`;
      } else {
        verdict = 'ждут предыдущих';
      }
    }
    columns.push({ title: columnTitle(c, lastCol), count: list.length, verdict, alarm });
  }

  // Headline: closed of total, and the deepest task everything later waits on.
  const epicBeads = opts.epicId === null ? [] : [...byId.values()].filter((b) => inEpicOf(b) && !cls.plumbing(b) && cls.debt(b) === null && cls.step(b) === null);
  const closed = epicBeads.filter((b) => b.status === 'closed').length;
  const lead = opts.epicId === null ? '' : `${epicKey ?? 'Эпик'}: ${closed} из ${epicBeads.length} закрыто. `;
  const tasks = nodes.filter((n) => n.kind === 'task');
  let cut: GraphNode | undefined;
  for (const n of tasks) {
    if (n.column >= lastCol || colOf(n.column).length !== 1) continue;
    const later = tasks.filter((x) => x.column > n.column);
    const down = walk(n.id, downAdj);
    if (later.length > 0 && later.every((x) => down.has(x.id)) && (cut === undefined || n.column < cut.column)) cut = n;
  }
  let story: string;
  if (cut !== undefined) {
    const waits = (upAdj.get(cut.id) ?? []).map(shortOf);
    story = `Всё дальше стоит за ${cut.label}` + (waits.length > 0 ? `: она ждёт ${joinAnd(waits)}.` : '.');
  } else {
    const top = [...tasks].sort((a, b) => b.holds - a.holds || byLabel(a, b))[0];
    story = top === undefined || top.holds === 0 ? 'Задачи друг друга не ждут.' : `Больше всех держит ${top.label}: ждут ${top.holds}.`;
  }
  const headline = `${lead}${story}`.trim();
  const idle = tasks.filter((n) => n.state === 'nobody_took' || n.state === 'free').length;
  const questions = nodes.filter((n) => n.kind === 'question').length;
  const subline =
    opts.partial === true
      ? 'Данные догружаются: кто ничего не ждёт, может ждать то, что ещё не прочитано.'
      : idle > 0
      ? `Без причины ${idle === 1 ? 'стоит' : 'стоят'} ${idle}: никто не взял.`
      : questions > 0
        ? 'Без причины не стоит ничего: что не в работе, ждёт других задач или твоих ответов — они слева, в колонке «От тебя».'
        : 'Без причины не стоит ничего.';

  return { nodes, edges, columns, headline, subline };
}

function adjacency(model: GraphModel) {
  const up = new Map<string, string[]>();
  const down = new Map<string, string[]>();
  for (const e of model.edges) {
    up.set(e.to, [...(up.get(e.to) ?? []), e.from]);
    down.set(e.from, [...(down.get(e.from) ?? []), e.to]);
  }
  return { up, down };
}

export function chainOf(model: GraphModel, id: string): Chain {
  const { up, down } = adjacency(model);
  // Pruned edges keep reachability, so a direct dependant whose only
  // remaining in-edge is from `id` starts right after it.
  const downNow = new Set((down.get(id) ?? []).filter((x) => (up.get(x) ?? []).every((f) => f === id)));
  return { up: walk(id, up), down: walk(id, down), downNow };
}

const STATE_WORD: Record<GraphNodeState, string> = {
  in_work: 'в работе',
  waits_owner: 'ждёт тебя',
  waits_task: 'ждёт',
  free: 'свободна',
  nobody_took: 'никто не взял',
  failed: 'упала',
  done: 'готово',
};

/** The hover/selection banner; null when there is nothing to say (a question that holds nothing). */
export function whatIfBanner(model: GraphModel, id: string): string | null {
  const node = model.nodes.find((n) => n.id === id);
  if (node === undefined) return null;
  const chain = chainOf(model, id);
  const now = chain.downNow.size;
  const total = chain.down.size;
  if (node.kind === 'question') {
    if (total === 0) return null;
    return `Если ответишь: сразу ${now === 1 ? 'пойдёт' : 'пойдут'} ${now}, всего откроется ${total}`;
  }
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const blockers = model.edges
    .filter((e) => e.to === id)
    .map((e) => byId.get(e.from))
    .filter((n): n is GraphNode => n !== undefined)
    .map((n) => `${n.kind === 'question' ? n.label.replace(/^вопрос · /u, '') : n.label} ${STATE_WORD[n.state]}`);
  const waits = blockers.length === 0 ? 'ничего не ждёт' : `ждёт ${blockers.length}: ${blockers.join(', ')}`;
  return `${node.label} ${waits} · откроет ${now} сразу, ${total} всего`;
}
