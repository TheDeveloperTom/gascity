import type { GraphEdge, GraphNode } from './model';

// allv STUB: contract types only (ALL-README «Lane contract»). The allm lane
// owns the real boardModel.ts with buildBoardGraph; at integration take theirs.

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
  columns: { title: string; count: number; verdict: string; alarm: boolean }[];
  headline: string;
  subline: string;
  warnings: string[];
}
