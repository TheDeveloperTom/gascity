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
// The stage comes from the RUN, never from the task's own status (review
// I-1): a live run counts once its root or a step is running, or the task
// has a PR. A live run that has not started is queued. A task whose run
// ended, failed or was stopped is never shown at a working stage; the board
// marks it, and the city block lists it as a problem.

export type FlightStage = Exclude<StageId, 'waiting' | 'merged'>;

export interface TaskInFlight {
  id: string;
  title: string;
  stage: FlightStage;
  stepLabel: string | null;
  href: string;
}

export interface TaskStages {
  state: 'loading' | 'ready' | 'unavailable';
  inFlight: readonly TaskInFlight[];
  queued: number;
  outsideWindow: number;
}

const LOADING: TaskStages = { state: 'loading', inFlight: [], queued: 0, outsideWindow: 0 };

const FLIGHT_ORDER: Readonly<Record<FlightStage, number>> = { pr: 0, review: 1, working: 2 };

function isFlightStage(stage: StageId): stage is FlightStage {
  return stage === 'working' || stage === 'review' || stage === 'pr';
}

const UNAVAILABLE: TaskStages = {
  state: 'unavailable',
  inFlight: [],
  queued: 0,
  outsideWindow: 0,
};

/** Marks that mean the run is not working on the task, whatever its status. */
const HALTED_MARKS: ReadonlySet<string> = new Set(['route-stopped', 'route-failed', 'stopped']);

type Flight = 'in-flight' | 'queued' | 'none';

function flightOf(status: string | undefined, stage: TaskStage): Flight {
  if (stage.marks.some((mark) => HALTED_MARKS.has(mark.kind))) return 'none';
  if (stage.pr !== null) return 'in-flight';
  const liveRoot = stage.root !== null && stage.root.status !== 'closed' ? stage.root : null;
  if (liveRoot !== null) {
    const started = liveRoot.status === 'in_progress' || stage.step?.status === 'in_progress';
    return started ? 'in-flight' : 'queued';
  }
  // No live run is visible. deriveTaskStage marks an in-progress task
  // «route stopped» whenever the window was complete, so reaching here means
  // the window was truncated: the run may simply be outside it.
  return status === 'in_progress' ? 'in-flight' : 'none';
}

function beadHref(id: string): string {
  const search = new URLSearchParams({ bead: id });
  return `/beads?${search.toString()}`;
}

export function deriveTaskStages(snapshot: BeadSnapshot | undefined): TaskStages {
  if (snapshot === undefined) return LOADING;
  if (snapshot.status === 'unavailable') return UNAVAILABLE;
  const tasks = snapshot.items.filter((bead) => !isRouteBead(bead));
  const graph = buildBeadGraph(tasks);
  const index = buildRouteIndex(snapshot.routeItems, {
    routesComplete: snapshot.routesComplete ?? true,
  });
  const stopCards = stopCardsByTask(tasks);
  const inFlight: TaskInFlight[] = [];
  let queued = 0;
  for (const node of graph.nodes.values()) {
    const task = node.bead;
    if (task.status === 'closed') continue;
    const stage = deriveTaskStage(node, index, stopCards);
    const flight = flightOf(task.status, stage);
    if (flight === 'in-flight' && isFlightStage(stage.stage)) {
      inFlight.push({
        id: task.id,
        title: task.title,
        stage: stage.stage,
        stepLabel: stage.stepLabel,
        href: stage.root === null ? beadHref(task.id) : routeRunHref(stage.root, stage.step),
      });
    } else if (flight === 'queued') {
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
