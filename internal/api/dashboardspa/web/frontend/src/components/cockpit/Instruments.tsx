import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { StatusShape } from '../icons';
import { pipelineWidths, type PipelineSegment, type RunRingModel } from './model';

// Home instruments (DESIGN-PLAN §6.2, R7). Quiet on purpose: the signal board
// above them is the loud thing. Readings are numbers with a slim meter, never
// a needle, and a missing reading draws nothing that could pass for a value.

export function InstrumentNote({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-label text-fg-faint">{children}</p>;
}

export function Odometer({
  label,
  value,
  note,
}: {
  label: string;
  value: number | null;
  note?: string | undefined;
}) {
  const reading = value === null ? null : Math.max(0, Math.floor(value));
  const digits = reading === null ? '—' : String(reading);
  return (
    <div
      role="status"
      aria-label={`${label}: ${reading === null ? 'unavailable' : reading}`}
      className="min-w-0"
    >
      <div aria-hidden className="text-headline font-semibold text-fg tnum">
        {digits}
      </div>
      <div className="text-label text-fg-muted">{label}</div>
      {/* Same height as a gauge meter, so the notes in the row line up. */}
      <div aria-hidden className="mt-2 h-1" />
      {note && <InstrumentNote>{note}</InstrumentNote>}
    </div>
  );
}

export function StatTile({
  label,
  value,
  note,
}: {
  label: string;
  value: string | null;
  note?: string | undefined;
}) {
  return (
    <div
      role="status"
      aria-label={`${label}: ${value === null ? 'unavailable' : value}`}
      className="min-w-0"
    >
      <div aria-hidden className="text-title font-semibold text-fg tnum">
        {value === null ? '—' : value}
      </div>
      <div className="text-label text-fg-muted">{label}</div>
      {note && <InstrumentNote>{note}</InstrumentNote>}
    </div>
  );
}

export function Gauge({
  label,
  value,
  max,
  formatted,
  href,
  note,
}: {
  label: string;
  value: number | null;
  max: number;
  formatted: string;
  href: string;
  note?: string | undefined;
}) {
  const reading = value === null || !Number.isFinite(value) ? null : Math.max(0, value);
  const ratio = reading === null || max <= 0 ? 0 : Math.min(reading / max, 1);
  // The meter is two lines inside a 120×4 box: the track, then the fill.
  // Round caps would poke past the box, so both ends are butt-capped and the
  // fill starts and ends inside the viewport.
  const fillEnd = Math.max(0, Math.min(120, ratio * 120));
  return (
    <div className="min-w-0">
      <Link
        to={href}
        className="focus-mark group flex min-h-6 flex-col no-underline"
        aria-label={`${label}: ${reading === null ? 'unavailable' : formatted}`}
      >
        <span className="text-headline font-semibold text-fg tnum">
          {reading === null ? '—' : formatted}
        </span>
        <span className="text-label text-fg-muted group-hover:text-primary group-hover:underline">
          {label}
        </span>
        <svg
          viewBox="0 0 120 4"
          preserveAspectRatio="none"
          className="mt-2 block h-1 w-full max-w-40 overflow-hidden rounded-sm"
          aria-hidden
        >
          <line x1="0" y1="2" x2="120" y2="2" className="stroke-rule" strokeWidth="4" />
          {reading !== null && (
            <line
              x1="0"
              y1="2"
              x2={fillEnd}
              y2="2"
              className="stroke-fg-muted transition-all duration-300 motion-reduce:transition-none"
              strokeWidth="4"
            />
          )}
        </svg>
      </Link>
      {note && <InstrumentNote>{note}</InstrumentNote>}
    </div>
  );
}

export function ActivityTrace({
  samples,
  available = true,
  note,
}: {
  samples: readonly number[];
  available?: boolean | undefined;
  note?: string | undefined;
}) {
  const values = samples.length > 0 ? samples : [0];
  const max = Math.max(1, ...values);
  const points = values
    .map((value, index) => {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100;
      const y = 28 - (Math.max(0, value) / max) * 24;
      return `${x},${y}`;
    })
    .join(' ');
  const last = values.at(-1) ?? 0;
  const readingLabel = available
    ? `recent model activity: ${last} invocation${last === 1 ? '' : 's'} in the current window`
    : 'recent model activity: unavailable';
  return (
    <figure className="m-0" aria-label={`${readingLabel}${note ? `; ${note}` : ''}`}>
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <figcaption className="text-label font-medium text-fg-muted">
          Recent model activity
        </figcaption>
        <span className="text-label text-fg-faint tnum">
          {samples.length > 1 ? `${samples.length} samples` : 'collecting samples'}
        </span>
      </div>
      {/* No band until there is a line to draw; "collecting samples" says why. */}
      {samples.length > 1 && (
        <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-16 w-full" aria-hidden>
          <line x1="0" y1="28" x2="100" y2="28" className="stroke-rule" strokeWidth="0.4" />
          <polyline
            points={points}
            fill="none"
            className="stroke-fg"
            strokeWidth="1.2"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {note && <InstrumentNote>{note}</InstrumentNote>}
    </figure>
  );
}

export function PipelineBar({
  segments,
  available = true,
}: {
  segments: readonly PipelineSegment[];
  available?: boolean | undefined;
}) {
  const widths = pipelineWidths(segments.map((segment) => segment.count));
  return (
    <div
      aria-label={`runs in flight: ${available ? 'current' : 'unavailable'}`}
      data-testid="pipeline"
    >
      {available ? (
        <div className="flex h-3 gap-0.5 overflow-hidden rounded-sm" aria-hidden>
          {segments.map((segment, index) => (
            <span
              key={segment.key}
              data-testid="pipeline-track-segment"
              className={`block ${segment.count > 0 ? segmentTone(segment.key, index) : 'bg-rule'} transition-[width] duration-300 motion-reduce:transition-none`}
              style={{ width: `${widths[index] ?? 0}%` }}
            />
          ))}
        </div>
      ) : (
        // No reading: an empty dashed track, never four fake segments.
        <div
          data-testid="pipeline-empty-track"
          className="h-3 rounded-sm border border-dashed border-rule"
          aria-hidden
        />
      )}
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        {segments.map((segment, index) => (
          <Link
            key={segment.key}
            to={segment.href}
            aria-label={`${segment.label}: ${available ? segment.count : 'unavailable'}`}
            className="focus-mark group inline-flex min-h-6 items-center gap-2 no-underline"
          >
            <span
              aria-hidden
              className={`h-2 w-2 rounded-sm ${available ? segmentTone(segment.key, index) : 'border border-dashed border-rule'}`}
            />
            <span className="text-label text-fg-muted group-hover:text-primary group-hover:underline">
              {segment.label}
            </span>
            <span className="text-label font-semibold text-fg tnum">
              {available ? segment.count : '—'}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// Signal tones for run states (DESIGN-PLAN §6.2): queued waits quietly,
// running is go, waiting is the lamp, stopping fades out.
const SEGMENT_TONES: Record<string, string> = {
  pending: 'bg-fg-faint',
  active: 'bg-ok',
  waiting: 'bg-warn',
  canceling: 'bg-fg-muted',
};
const SEGMENT_TONE_ORDER = ['bg-fg-faint', 'bg-ok', 'bg-warn', 'bg-fg-muted'];

function segmentTone(key: string, index: number): string {
  return SEGMENT_TONES[key] ?? SEGMENT_TONE_ORDER[index] ?? 'bg-fg-faint';
}

export interface ContextMeter {
  id: string;
  label: string;
  value: number;
  href: string;
}

export function ContextMeters({ meters }: { meters: readonly ContextMeter[] }) {
  return (
    <div
      className="grid gap-x-6 gap-y-2 [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))]"
      data-testid="context-meters"
    >
      {meters.map((meter) => {
        const value = Math.min(Math.max(meter.value, 0), 100);
        // Same thresholds as the Agents context cell: ≥80 amber, ≥95 red.
        const fill = value >= 95 ? 'bg-accent' : value >= 80 ? 'bg-warn' : 'bg-fg-muted';
        return (
          <Link
            key={meter.id}
            to={meter.href}
            className="focus-mark group grid min-h-6 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 no-underline"
            aria-label={`${meter.label}: ${Math.round(value)}% context used`}
          >
            <span className="truncate text-label text-fg-muted group-hover:text-primary group-hover:underline">
              {meter.label}
            </span>
            <span className="text-label font-semibold text-fg tnum">{Math.round(value)}%</span>
            <span
              className="relative col-span-2 block h-1 overflow-hidden rounded-sm bg-rule"
              aria-hidden
            >
              <span
                className={`absolute inset-y-0 left-0 ${fill} transition-[width] duration-300 motion-reduce:transition-none`}
                style={{ width: `${value}%` }}
              />
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export function RunRings({ runs }: { runs: readonly RunRingModel[] }) {
  return (
    <div className="flex min-h-24 flex-wrap content-start gap-3" data-testid="run-rings">
      {runs.map((run) => {
        const circumference = 2 * Math.PI * 28;
        const progress = Math.min(Math.max(run.stage / Math.max(run.totalStages, 1), 0), 1);
        const retry = run.attempt !== undefined && run.attempt > 1;
        const retryLabel = retry ? `, retry attempt ${run.attempt}` : '';
        return (
          <Link
            key={run.id}
            to={run.href}
            className="focus-mark inline-flex min-h-6 w-20 flex-col items-center no-underline"
            aria-label={`${run.label}: stage ${run.stage} of ${run.totalStages}${retryLabel}`}
          >
            <span className="relative block h-20 w-20" aria-hidden>
              <svg viewBox="0 0 72 72" width="80" height="80">
                <circle
                  cx="36"
                  cy="36"
                  r="28"
                  fill="none"
                  className="stroke-rule"
                  strokeWidth="3"
                />
                <circle
                  cx="36"
                  cy="36"
                  r="28"
                  fill="none"
                  className="stroke-ok transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none"
                  strokeWidth="3"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference * (1 - progress)}
                  transform="rotate(-90 36 36)"
                />
              </svg>
              <span className="absolute inset-0 flex flex-col items-center justify-center px-2.5 text-center text-label text-fg tnum">
                <span>
                  {run.stage}/{run.totalStages}
                </span>
                {/* 12 px stage word so "Review" fits inside the ring (Golos is wider than Inter). */}
                <span
                  className={`w-full truncate text-[0.75rem] leading-4 ${retry ? 'text-warn' : 'text-fg-faint'}`}
                  title={retry ? `retry ${run.attempt}` : run.stageWord}
                >
                  {retry ? `retry ${run.attempt}` : run.stageWord}
                </span>
              </span>
            </span>
            <span className="w-20 truncate text-center text-label text-fg-muted">{run.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

export type LampState = 'healthy' | 'warning' | 'unknown';
export interface StatusLamp {
  key: string;
  label: string;
  value: string;
  state: LampState;
  href: string;
}

const LAMP_SHAPE: Record<LampState, 'ok' | 'warn' | 'neutral'> = {
  healthy: 'ok',
  warning: 'warn',
  unknown: 'neutral',
};

const LAMP_TONE: Record<LampState, string> = {
  healthy: 'text-ok',
  warning: 'text-warn',
  unknown: 'text-fg-muted',
};

// The value text: a healthy reading is quiet ink (the green shape already
// says healthy); only a warning keeps its signal colour.
const LAMP_VALUE_TONE: Record<LampState, string> = {
  healthy: 'text-fg-muted',
  warning: 'text-warn',
  unknown: 'text-fg-muted',
};

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function StatusLamps({ lamps }: { lamps: readonly StatusLamp[] }) {
  return (
    <ul className="divide-y divide-rule">
      {lamps.map((lamp) => (
        <li key={lamp.key}>
          <Link
            to={lamp.href}
            className="focus-mark group grid min-h-10 grid-cols-[8px_minmax(0,1fr)] items-center gap-x-2.5 py-1.5 no-underline"
            aria-label={`${lamp.label}: ${lamp.state}, ${lamp.value}`}
          >
            <span aria-hidden className={`flex ${LAMP_TONE[lamp.state]}`}>
              <StatusShape tone={LAMP_SHAPE[lamp.state]} />
            </span>
            <span className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-body text-fg group-hover:text-primary group-hover:underline">
                {sentenceCase(lamp.label)}
              </span>
              <span className={`text-label ${LAMP_VALUE_TONE[lamp.state]}`}>{lamp.value}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
