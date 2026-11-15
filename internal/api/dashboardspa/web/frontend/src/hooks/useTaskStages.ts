import { useMemo } from 'react';
import { useBeadSnapshot } from '../attention/context';
import type { BeadSnapshot } from '../attention/liveContributors';
import { buildBeadGraph } from '../lib/beadGraph';
import {
  buildRouteIndex,
  deriveTaskStage,
  isRouteBead,
  routeRunHref,
  stopCardsByTask,
  type StageId,
  type TaskStage,
} from '../lib/stageBoard';

// Home's «Что идёт» (R5): tasks by title with their stage, from the same
// stage logic the board uses, over the attention bead read (R6, no fetch).
// A task is in flight only once its work has started: the task is in
// progress, a step of its run is running, or it has a PR. A run that has not
// started is queued, never shown at a stage it has not reached.

export type FlightStage = Exclude<StageId, 'waiting' | 'merged'>;

export interface TaskInFlight {
  id: string;
  title: string;
  stage: FlightStage;
  stepLabel: string | null;
  href: string;
}

export interface TaskStages {
  state: 'loading' | 'ready';
  inFlight: readonly TaskInFlight[];
  queued: number;
  outsideWindow: number;
}

const LOADING: TaskStages = { state: 'loading', inFlight: [], queued: 0, outsideWindow: 0 };

const FLIGHT_ORDER: Readonly<Record<FlightStage, number>> = { pr: 0, review: 1, working: 2 };

function isFlightStage(stage: StageId): stage is FlightStage {
  return stage === 'working' || stage === 'review' || stage === 'pr';
}

function hasStarted(status: string | undefined, stage: TaskStage): boolean {
  return status === 'in_progress' || stage.step?.status === 'in_progress' || stage.pr !== null;
}

function beadHref(id: string): string {
  const search = new URLSearchParams({ bead: id });
  return `/beads?${search.toString()}`;
}

export function deriveTaskStages(snapshot: BeadSnapshot | undefined): TaskStages {
  if (snapshot === undefined) return LOADING;
  const tasks = snapshot.items.filter((bead) => !isRouteBead(bead));
  const graph = buildBeadGraph(tasks);
  const index = buildRouteIndex(snapshot.routeItems);
  const stopCards = stopCardsByTask(tasks);
  const inFlight: TaskInFlight[] = [];
  let queued = 0;
  for (const node of graph.nodes.values()) {
    const task = node.bead;
    if (task.status === 'closed') continue;
    const stage = deriveTaskStage(node, index, stopCards);
    if (isFlightStage(stage.stage) && hasStarted(task.status, stage)) {
      inFlight.push({
        id: task.id,
        title: task.title,
        stage: stage.stage,
        stepLabel: stage.stepLabel,
        href: stage.root === null ? beadHref(task.id) : routeRunHref(stage.root, stage.step),
      });
    } else if (stage.root !== null && stage.root.status !== 'closed') {
      queued += 1;
    }
  }
  inFlight.sort(
    (a, b) => FLIGHT_ORDER[a.stage] - FLIGHT_ORDER[b.stage] || a.title.localeCompare(b.title),
  );
  const outsideWindow = index.orphanRoots(new Set(tasks.map((bead) => bead.id))).length;
  return { state: 'ready', inFlight, queued, outsideWindow };
}

export function useTaskStages(): TaskStages {
  const snapshot = useBeadSnapshot();
  return useMemo(() => deriveTaskStages(snapshot), [snapshot]);
}
