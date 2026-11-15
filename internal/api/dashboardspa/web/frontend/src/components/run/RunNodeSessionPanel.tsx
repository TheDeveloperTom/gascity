import type { RunDisplayNode, RunExecutionInstance } from 'gas-city-dashboard-shared';
import { useEffect, useMemo, useState } from 'react';
import { useSessionStream, type SessionStreamProgress } from '../../hooks/useSessionStream';
import { SessionPeekContent } from '../SessionPeek';
import { StatusBadge, type StatusTone } from '../StatusBadge';

// Iteration and attempt pickers are radio chips (DESIGN-PLAN §7 chip recipe):
// blue when chosen, hairline otherwise. Roles and aria-checked are unchanged.
const RADIO_CHIP =
  'h-7 rounded-full border px-2.5 text-label font-medium transition-colors duration-150 ease-out-quart focus-mark';
const RADIO_ON = 'border-primary/50 bg-primary/10 text-primary';
const RADIO_OFF = 'border-rule bg-surface-raised text-fg-muted hover:text-fg';

interface RunNodeSessionPanelProps {
  node: RunDisplayNode | null;
  visible: boolean;
}

export function RunNodeSessionPanel({ node, visible }: RunNodeSessionPanelProps) {
  const instances = useMemo(() => node?.executionInstances.sort(compareInstances) ?? [], [node]);
  const defaultInstance = useMemo(
    () => defaultVisibleInstance(node?.visibleExecutionInstanceId, instances),
    [node?.visibleExecutionInstanceId, instances],
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    setSelectedKey(defaultInstance ? instanceKey(defaultInstance) : null);
  }, [node?.id, defaultInstance]);

  if (!node) {
    return <p className="text-body text-fg-muted">Select a node to inspect its session.</p>;
  }
  if (instances.length === 0) {
    return <p className="text-body text-fg-muted">{sessionUnavailableCopy(node)}</p>;
  }

  const selected =
    instances.find((instance) => instanceKey(instance) === selectedKey) ??
    defaultInstance ??
    instances[0];
  const selectedIteration = selected ? iterationValue(selected) : 'base';
  const iterationGroups = groupIterations(instances);
  const attempts = instances.filter((instance) => iterationValue(instance) === selectedIteration);
  if (!selected) {
    return <p className="text-body text-fg-muted">{sessionUnavailableCopy(node)}</p>;
  }

  return (
    <section>
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="min-w-0 text-title font-semibold text-fg [overflow-wrap:anywhere]">
          {node.title}
        </h3>
        {(node.historicalOnly || selected?.historical) && (
          <span className="shrink-0 rounded-full bg-fg/[0.06] px-2 py-0.5 text-label font-medium text-fg-muted">
            {node.historicalOnly ? 'historical-only' : 'historical'}
          </span>
        )}
      </div>
      {iterationGroups.length > 1 && (
        <div
          className="mt-3 flex flex-wrap items-center gap-1.5 text-label"
          role="radiogroup"
          aria-label="Iterations"
        >
          <span className="mr-1 font-medium text-fg-muted">Iterations</span>
          {iterationGroups.map((group) => {
            const instance = group.instances.at(-1);
            if (!instance) return null;
            const label = group.iteration === 'base' ? 'Base' : `Iteration ${group.iteration}`;
            const active = group.iteration === selectedIteration;
            return (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={active}
                className={`${RADIO_CHIP} ${active ? RADIO_ON : RADIO_OFF}`}
                onClick={() => setSelectedKey(instanceKey(instance))}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      {attempts.length > 1 && (
        <div
          className="mt-2 flex flex-wrap items-center gap-1.5 text-label"
          role="radiogroup"
          aria-label="Attempts"
        >
          <span className="mr-1 font-medium text-fg-muted">Attempts</span>
          {attempts.map((instance) => {
            const active = instanceKey(instance) === instanceKey(selected);
            return (
              <button
                key={instanceKey(instance)}
                type="button"
                role="radio"
                aria-checked={active}
                className={`${RADIO_CHIP} ${active ? RADIO_ON : RADIO_OFF}`}
                onClick={() => setSelectedKey(instanceKey(instance))}
              >
                Attempt {attemptValue(instance)}
              </button>
            );
          })}
        </div>
      )}
      <dl className="mt-4 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-label">
        <dt className="font-medium text-fg-muted">Execution instance</dt>
        <dd className="break-all font-mono text-[0.8125rem] text-fg-muted">{selected.id}</dd>
        <dt className="font-medium text-fg-muted">Bead</dt>
        <dd className="break-all font-mono text-[0.8125rem] text-fg-muted">{selected.beadId}</dd>
      </dl>
      <SessionTranscript instance={selected} visible={visible} />
    </section>
  );
}

function SessionTranscript({
  instance,
  visible,
}: {
  instance: RunExecutionInstance;
  visible: boolean;
}) {
  const attached = instance.session.kind === 'attached' ? instance.session : null;
  const sessionId = attached?.link?.sessionId ?? null;
  const stream = visible && Boolean(attached?.streamable);
  const sessionState = useSessionStream(sessionId, stream);
  if (attached === null) {
    return (
      <p className="mt-5 text-body text-fg-muted">{instanceSessionUnavailableCopy(instance)}</p>
    );
  }
  if (sessionId === null) {
    // An `attached` session with no link is the public floor's redacted shape:
    // there is no session id to fetch, so render graceful copy instead of
    // dereferencing an absent link (which previously crashed the run view).
    return (
      <p className="mt-5 text-body text-fg-muted">
        Session transcript is unavailable for this node.
      </p>
    );
  }
  const badge = streamBadge(sessionState.stream);
  const loading = sessionState.status === 'loading';
  const result = sessionState.status === 'ready' ? sessionState.result : null;
  const error = sessionState.status === 'failed' ? sessionState.error : null;
  const streamError =
    sessionState.status === 'ready' && sessionState.stream.status === 'degraded'
      ? sessionState.stream.error
      : null;
  return (
    <div className="mt-5 space-y-4">
      {attached?.streamable && (
        <div className="flex justify-end">
          <StatusBadge
            tone={badge.tone}
            label={badge.label}
            title={`Session stream: ${sessionState.stream.status}`}
          />
        </div>
      )}
      {streamError !== null && (
        <p className="text-body text-accent" role="alert">
          {streamError}
        </p>
      )}
      <SessionPeekContent loading={loading} error={error} result={result} />
    </div>
  );
}

function streamBadge(stream: SessionStreamProgress): {
  tone: StatusTone;
  label: string;
} {
  switch (stream.status) {
    case 'open':
      return { tone: 'ok', label: 'live' };
    case 'connecting':
      return { tone: 'warn', label: 'connecting' };
    case 'closed':
      return { tone: 'stuck', label: 'offline' };
    case 'degraded':
      return { tone: 'warn', label: 'degraded' };
    case 'idle':
      return { tone: 'neutral', label: 'snapshot' };
  }
}

function sessionUnavailableCopy(node: RunDisplayNode): string {
  const missing = node.executionInstances.filter((instance) => instance.session.kind === 'none');
  const hasUnresolvedRunning = missing.some(
    (instance) =>
      instance.currentIteration &&
      instance.session.kind === 'none' &&
      instance.session.reason === 'session_unresolved' &&
      isRunningStatus(instance.status),
  );
  if (hasUnresolvedRunning) {
    return 'Session unresolved for the current running node.';
  }
  if (
    missing.some(
      (instance) =>
        instance.session.kind === 'none' && instance.session.reason === 'session_unresolved',
    )
  ) {
    return 'Session unresolved for this node.';
  }
  return 'This node has not started a session yet.';
}

function instanceSessionUnavailableCopy(instance: RunExecutionInstance): string {
  if (instance.session.kind === 'attached') return '';
  if (
    instance.currentIteration &&
    instance.session.reason === 'session_unresolved' &&
    isRunningStatus(instance.status)
  ) {
    return 'Session unresolved for the current running node.';
  }
  if (instance.session.reason === 'session_unresolved') {
    return 'Session unresolved for this node.';
  }
  return 'This node has not started a session yet.';
}

function isRunningStatus(status: RunExecutionInstance['status']): boolean {
  return status === 'active' || status === 'running';
}

/**
 * Resolve the instance to show first, honoring the server's already-computed
 * `visibleExecutionInstanceId` instead of re-deriving a preference client-side.
 * That server field is the node's CURRENT-iteration instance (the last in Go's
 * sort order) — the same instance that drives the node's status pill and
 * current-bead — so the panel default now stays consistent with the rest of the
 * run view. This INTENTIONALLY differs from the retired client fold, which
 * preferred a streamable-attached (then last-attached) instance: when the
 * current iteration is queued/not-started but a prior iteration has a transcript,
 * the panel now defaults to the current not-started instance (the prior
 * transcript stays reachable via the Iteration selector). Falls back to the last
 * instance in sort order when the id is absent or matches no instance — e.g. a
 * snapshot whose visible instance rotated out of this node.
 */
function defaultVisibleInstance(
  visibleExecutionInstanceId: string | undefined,
  instances: RunExecutionInstance[],
): RunExecutionInstance | undefined {
  const preferred = visibleExecutionInstanceId
    ? instances.find((instance) => instanceKey(instance) === visibleExecutionInstanceId)
    : undefined;
  return preferred ?? instances.at(-1);
}

function groupIterations(instances: RunExecutionInstance[]) {
  const groups = new Map<number | 'base', RunExecutionInstance[]>();
  for (const instance of instances) {
    const key = iterationValue(instance);
    groups.set(key, [...(groups.get(key) ?? []), instance]);
  }
  return [...groups.entries()]
    .map(([iteration, groupInstances]) => ({
      iteration,
      instances: groupInstances.sort(compareInstances),
    }))
    .sort((a, b) => iterationOrder(a.iteration) - iterationOrder(b.iteration));
}

function compareInstances(left: RunExecutionInstance, right: RunExecutionInstance): number {
  return (
    iterationOrder(iterationValue(left)) - iterationOrder(iterationValue(right)) ||
    attemptValue(left) - attemptValue(right) ||
    left.id.localeCompare(right.id)
  );
}

function instanceKey(instance: RunExecutionInstance): string {
  return instance.id;
}

function iterationValue(instance: RunExecutionInstance): number | 'base' {
  return instance.iteration.kind === 'loop' ? instance.iteration.value : 'base';
}

function iterationOrder(iteration: number | 'base'): number {
  return iteration === 'base' ? 0 : iteration;
}

function attemptValue(instance: RunExecutionInstance): number {
  return instance.attempt.kind === 'attempt' ? instance.attempt.value : 1;
}
