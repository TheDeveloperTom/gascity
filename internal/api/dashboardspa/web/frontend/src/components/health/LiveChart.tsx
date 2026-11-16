import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { t } from '../../i18n';
import { LIVE_GAP_MS } from '../../lib/hostLive';

// A small realtime time-series chart for the Health page (owner 16.11:
// «красивые понятные графики, риалтайм»). Hand-drawn SVG, no chart library:
// one shared 0–100 % axis per chart, a 2 px line (the first series also as a
// 10 % wash), a ringed end dot, solid hairline grid, a crosshair and one
// tooltip listing every series at the hovered moment. Arrow keys move the
// crosshair for keyboard readers; the accessible name carries the latest
// values, so nothing hides behind hover.

export interface ChartPoint {
  at: number;
  v: number | null;
}

export interface ChartSeries {
  id: string;
  label: string;
  /** A CSS colour, normally var(--viz-N). Marks only, never text. */
  color: string;
  kind: 'area' | 'line';
  points: ChartPoint[];
}

export interface ChartThreshold {
  value: number;
  label: string;
}

interface LiveChartProps {
  label: string;
  series: ChartSeries[];
  now: number;
  windowMs: number;
  formatValue: (v: number) => string;
  /** Lowest top of the y axis; it grows past it in steps of 25. */
  yMin?: number;
  /** Highest top of the y axis; values above it ride the top edge (the
   *  tooltip and the card still read the true value). */
  yCap?: number;
  threshold?: ChartThreshold;
  height?: number;
}

const GUTTER_LEFT = 40;
const GUTTER_RIGHT = 10;
const PAD_TOP = 10;
const AXIS_BAND = 22;
const FALLBACK_WIDTH = 600;

/** An SVG path through the points; a gap in time or a missing value starts a new run. */
export function linePath(
  points: readonly ChartPoint[],
  x: (at: number) => number,
  y: (v: number) => number,
  gapMs: number = LIVE_GAP_MS,
): string {
  let d = '';
  let prevAt: number | null = null;
  for (const p of points) {
    if (p.v === null) {
      prevAt = null;
      continue;
    }
    const move = prevAt === null || p.at - prevAt > gapMs;
    d += `${move ? 'M' : 'L'}${x(p.at).toFixed(1)},${y(p.v).toFixed(1)}`;
    prevAt = p.at;
  }
  return d;
}

/** The area under each run of linePath, closed down to the baseline. */
function areaPath(
  points: readonly ChartPoint[],
  x: (at: number) => number,
  y: (v: number) => number,
  baseline: number,
): string {
  let d = '';
  let run: Array<{ at: number; v: number }> = [];
  const flush = () => {
    if (run.length > 1) {
      const first = run[0] as { at: number; v: number };
      const last = run[run.length - 1] as { at: number; v: number };
      d += `M${x(first.at).toFixed(1)},${baseline}`;
      for (const p of run) d += `L${x(p.at).toFixed(1)},${y(p.v).toFixed(1)}`;
      d += `L${x(last.at).toFixed(1)},${baseline}Z`;
    }
    run = [];
  };
  for (const p of points) {
    const prev = run.at(-1);
    if (p.v === null || (prev !== undefined && p.at - prev.at > LIVE_GAP_MS)) flush();
    if (p.v !== null) run.push({ at: p.at, v: p.v });
  }
  flush();
  return d;
}

function lastValue(points: readonly ChartPoint[]): ChartPoint | null {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const p = points[i] as ChartPoint;
    if (p.v !== null) return p;
  }
  return null;
}

function useWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setWidth(w);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function LiveChart({
  label,
  series,
  now,
  windowMs,
  formatValue,
  yMin = 100,
  yCap = Number.POSITIVE_INFINITY,
  threshold,
  height = 132,
}: LiveChartProps) {
  const [ref, width] = useWidth();
  const [cursor, setCursor] = useState<number | null>(null);

  const primary = series[0]?.points ?? [];
  const known = primary.filter((p) => p.v !== null);
  const enough = known.length >= 2;

  const peak = Math.max(
    yMin,
    ...series.flatMap((s) => s.points.map((p) => p.v ?? 0)),
    threshold?.value ?? 0,
  );
  const yTop = Math.min(Math.ceil(peak / 25) * 25, Math.max(yMin, yCap));
  const ticks = [0, yTop / 2, yTop];

  const plotW = Math.max(40, width - GUTTER_LEFT - GUTTER_RIGHT);
  const plotH = height - PAD_TOP;
  const from = now - windowMs;
  const x = (at: number) => GUTTER_LEFT + ((at - from) / windowMs) * plotW;
  const y = (v: number) => PAD_TOP + plotH - (Math.min(v, yTop) / yTop) * plotH;
  const baseline = PAD_TOP + plotH;

  const minutes = Math.round(windowMs / 60_000);
  const xLabels = [3, 2, 1, 0].map((k) => ({
    at: from + (windowMs * (3 - k)) / 3,
    text: k === 0 ? t('now') : t('−{n} min', { n: Math.round((minutes * k) / 3) }),
  }));

  // The cursor indexes the primary series; keyboard starts from the latest.
  const cursorIndex = cursor === null ? null : Math.min(Math.max(cursor, 0), primary.length - 1);
  const cursorAt = cursorIndex === null ? null : (primary[cursorIndex]?.at ?? null);

  const valueAt = (s: ChartSeries, at: number): number | null => {
    let best: ChartPoint | null = null;
    for (const p of s.points) {
      if (best === null || Math.abs(p.at - at) < Math.abs(best.at - at)) best = p;
    }
    return best !== null && Math.abs(best.at - at) <= LIVE_GAP_MS ? best.v : null;
  };

  const latest = series
    .map((s) => {
      const p = lastValue(s.points);
      return p === null ? null : `${s.label} ${formatValue(p.v as number)}`;
    })
    .filter((v): v is string => v !== null);
  const accessibleName = `${label}: ${latest.length > 0 ? latest.join(', ') : t('Collecting data…')}`;

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!enough) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const at = from + ((px - GUTTER_LEFT) / plotW) * windowMs;
    let best = 0;
    primary.forEach((p, i) => {
      if (Math.abs(p.at - at) < Math.abs((primary[best]?.at ?? 0) - at)) best = i;
    });
    setCursor(best);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!enough) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Escape') return;
    event.preventDefault();
    if (event.key === 'Escape') {
      setCursor(null);
      return;
    }
    const start = cursorIndex ?? primary.length - 1;
    setCursor(start + (event.key === 'ArrowLeft' ? -1 : 1));
  };

  const paths = useMemo(
    () =>
      series.map((s) => ({
        s,
        line: linePath(s.points, x, y),
        area: s.kind === 'area' ? areaPath(s.points, x, y, baseline) : '',
        end: lastValue(s.points),
      })),
    // x and y close over these inputs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, width, now, windowMs, yTop, height],
  );

  const tipLeft = cursorAt === null ? 0 : x(cursorAt);
  const tipOnRight = tipLeft < width / 2;

  return (
    <div
      ref={ref}
      role="img"
      aria-label={accessibleName}
      tabIndex={0}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setCursor(null)}
      onKeyDown={onKeyDown}
      onBlur={() => setCursor(null)}
      className="relative w-full touch-pan-y select-none rounded outline-none focus-visible:ring-2 focus-visible:ring-[oklch(var(--plate-ring))]"
      style={{ height: height + AXIS_BAND }}
    >
      <svg
        width={width}
        height={height + AXIS_BAND}
        aria-hidden="true"
        className="block overflow-visible"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={GUTTER_LEFT}
              x2={GUTTER_LEFT + plotW}
              y1={y(tick)}
              y2={y(tick)}
              stroke="oklch(var(--rule))"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text
              x={GUTTER_LEFT - 8}
              y={y(tick)}
              dy="0.32em"
              textAnchor="end"
              className="fill-fg-faint text-[11px] tabular-nums"
            >
              {formatValue(tick)}
            </text>
          </g>
        ))}
        {threshold !== undefined && threshold.value < yTop && (
          <g>
            <line
              x1={GUTTER_LEFT}
              x2={GUTTER_LEFT + plotW}
              y1={y(threshold.value)}
              y2={y(threshold.value)}
              stroke="oklch(var(--warn))"
              strokeOpacity={0.7}
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text
              x={GUTTER_LEFT + 4}
              y={
                y(threshold.value) - PAD_TOP < 14 ? y(threshold.value) + 13 : y(threshold.value) - 4
              }
              textAnchor="start"
              className="fill-fg-muted text-[11px]"
            >
              {threshold.label}
            </text>
          </g>
        )}
        {xLabels.map((l, i) => (
          <text
            key={l.text}
            x={x(l.at)}
            y={height + AXIS_BAND - 5}
            textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
            className="fill-fg-faint text-[11px] tabular-nums"
          >
            {l.text}
          </text>
        ))}
        {enough &&
          paths.map(({ s, line, area }) => (
            <g key={s.id}>
              {area !== '' && <path d={area} fill={s.color} fillOpacity={0.12} stroke="none" />}
              <path
                d={line}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>
          ))}
        {enough &&
          paths.map(({ s, end }) =>
            end === null || end.v === null ? null : (
              <circle
                key={`${s.id}-end`}
                cx={x(end.at)}
                cy={y(end.v)}
                r={4}
                fill={s.color}
                stroke="oklch(var(--surface-raised))"
                strokeWidth={2}
              />
            ),
          )}
        {cursorAt !== null && (
          <g>
            <line
              x1={x(cursorAt)}
              x2={x(cursorAt)}
              y1={PAD_TOP}
              y2={baseline}
              stroke="oklch(var(--fg-faint))"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            {series.map((s) => {
              const v = valueAt(s, cursorAt);
              return v === null ? null : (
                <circle
                  key={`${s.id}-cursor`}
                  cx={x(cursorAt)}
                  cy={y(v)}
                  r={4}
                  fill={s.color}
                  stroke="oklch(var(--surface-raised))"
                  strokeWidth={2}
                />
              );
            })}
          </g>
        )}
      </svg>
      {!enough && (
        <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-label text-fg-faint">
          {t('Collecting data…')}
        </p>
      )}
      {cursorAt !== null && (
        <div
          role="status"
          className="pointer-events-none absolute top-1 z-10 min-w-[9rem] rounded-md border border-rule bg-surface-raised px-3 py-2 shadow-overlay"
          style={
            tipOnRight
              ? { left: Math.min(tipLeft + 12, width - 150) }
              : { right: Math.max(width - tipLeft + 12, 0) }
          }
        >
          <p className="text-[11px] text-fg-faint tabular-nums">{clockTime(cursorAt)}</p>
          <ul className="mt-1 space-y-0.5">
            {series.map((s) => {
              const v = valueAt(s, cursorAt);
              return (
                <li key={s.id} className="flex items-center gap-2 text-label">
                  <span
                    aria-hidden="true"
                    className="h-0.5 w-3 rounded-full"
                    style={{ background: s.color }}
                  />
                  <span className="font-semibold text-fg tabular-nums">
                    {v === null ? '—' : formatValue(v)}
                  </span>
                  <span className="text-fg-muted">{s.label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
