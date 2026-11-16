// STUB (page lane): the model lane owns this file; the integrator takes theirs.
// It follows the README contract so the page compiles and its tests run.
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

export function buildGraph(
  beads: ReadonlyArray<unknown>,
  _opts: { epicId: string | null; focusIds?: string[]; nowMs: number },
): GraphModel {
  const nodes: GraphNode[] = [];
  beads.forEach((b, row) => {
    const bead = b as { id?: unknown; title?: unknown };
    if (typeof bead.id !== 'string') return;
    nodes.push({
      id: bead.id,
      kind: 'task',
      label: bead.id,
      title: typeof bead.title === 'string' ? bead.title : bead.id,
      state: 'free',
      reason: '',
      holds: 0,
      column: 1,
      row,
      outside: false,
      assignee: null,
    });
  });
  return { nodes, edges: [], columns: [], headline: '', subline: '' };
}

export function chainOf(_model: GraphModel, _id: string): Chain {
  return { up: new Set(), down: new Set(), downNow: new Set() };
}

export function whatIfBanner(_model: GraphModel, _id: string): string {
  return '';
}
