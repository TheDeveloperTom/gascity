// VIEW-LANE STUB of the model lane's contract (docs/recovery/2026-11-16/graph/README.md).
// The integrator replaces this file with the model lane's real model.ts; nothing
// here beyond the contract's declarations is relied on by the view.

export type GraphNodeKind = 'question' | 'task';
export type GraphNodeState =
  | 'in_work'
  | 'waits_owner'
  | 'waits_task'
  | 'free'
  | 'nobody_took'
  | 'failed'
  | 'done';
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

export function buildGraph(
  _beads: ReadonlyArray<unknown>,
  _opts: { epicId: string | null; focusIds?: string[]; nowMs: number },
): GraphModel {
  throw new Error('view-lane stub: buildGraph lives in the model lane');
}

function walk(model: GraphModel, id: string, dir: 'up' | 'down'): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const n = stack.pop() as string;
    for (const e of model.edges) {
      const [here, there] = dir === 'up' ? [e.to, e.from] : [e.from, e.to];
      if (here === n && !out.has(there)) {
        out.add(there);
        stack.push(there);
      }
    }
  }
  return out;
}

export function chainOf(model: GraphModel, id: string): Chain {
  const down = walk(model, id, 'down');
  const done = new Set(model.nodes.filter((n) => n.state === 'done').map((n) => n.id));
  const downNow = new Set(
    [...down].filter((d) =>
      model.edges.every((e) => e.to !== d || e.from === id || done.has(e.from)),
    ),
  );
  return { up: walk(model, id, 'up'), down, downNow };
}

export function whatIfBanner(model: GraphModel, id: string): string {
  const c = chainOf(model, id);
  return `stub ${id}: ${c.downNow.size}/${c.down.size}`;
}
