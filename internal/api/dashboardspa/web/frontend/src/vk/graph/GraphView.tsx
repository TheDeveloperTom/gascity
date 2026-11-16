import { Fragment, useEffect, useMemo, useRef, useState, type RefObject, type SetStateAction } from 'react';
import { Avatar, GraphCard, ReasonChip, StateDot, type CardBox, type CardTone } from './GraphCard';
import { GraphIcon } from './icons';
import { chainOf, whatIfBanner, type Chain, type GraphModel, type GraphNode } from './model';
import { QuestionCard } from './QuestionCard';
import './graph.css';

// The «Граф» tab view (16.11). Desktop: Graph-Epic columns with verdicts,
// absolutely placed cards and SVG lines (gen.py Graph.path routing). Hover a
// card: V5 light toward it from its blockers and a wave away to what it
// opens; hover «Ответить»: the V1 what-if wave. Click: V5-Click, one card
// with a white ring and the chain held lit. Phone: Graph-Phone waves list.

export interface GraphViewProps {
  model: GraphModel;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAnswer: (questionId: string) => void;
}

// Columns are fluid (16.11 eyes at 2000 px): (available − gaps) / columns,
// clamped to [COLW_MIN, COLW_MAX]; 190 until the container is measured.
const COLW_MIN = 190;
const COLW_MAX = 380;
const GUTTER = 26;
const CARDH = 90;
const PITCH = 102;
const TOP = 100;

const AMBER = '#F59E0B';
const GREEN = '#22C55E';
const BLUE = '#3B82F6';
const GRAY = '#64748B';

export type Mode = 'card' | 'answer' | 'select';
export interface Focus {
  id: string;
  mode: Mode;
}
export type EdgeLit = 'idle' | 'faint' | 'held' | 'toward' | 'away' | 'wave';

export function columnColor(i: number, n: number): string {
  if (i === 0) return AMBER;
  if (i === 1) return GREEN;
  if (i === n - 1) return GRAY;
  return BLUE;
}

export function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const read = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [reduced, setReduced] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

type Measured<T> = readonly [ref: RefObject<T>, width: number | null];

/** Content-box width of the element, live via ResizeObserver; null until measured. */
function useContentWidth<T extends HTMLElement>(): Measured<T> {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[entries.length - 1]?.contentRect.width;
      if (w !== undefined && w > 0) setWidth((prev) => (prev !== null && Math.abs(prev - w) < 0.5 ? prev : w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

// ------------------------------------------------------------ layout

interface Layout {
  cols: number;
  colW: number;
  width: number;
  height: number;
  bottom: number;
  xs: number[];
  box: Map<string, CardBox & { col: number }>;
  paths: Map<string, string>;
}

export function bez(xs: number, ys: number, xe: number, ye: number): string {
  const dx = (xe - xs) * 0.5;
  return `C ${(xs + dx).toFixed(1)} ${ys.toFixed(1)}, ${(xe - dx).toFixed(1)} ${ye.toFixed(1)}, ${xe.toFixed(1)} ${ye.toFixed(1)}`;
}

export function layoutGraph(model: GraphModel, avail: number | null = null): Layout {
  const maxCol = model.nodes.reduce((m, n) => Math.max(m, n.column), 0);
  const cols = Math.max(model.columns.length, maxCol + 1);
  const fluid = avail === null ? COLW_MIN : (avail - (cols - 1) * GUTTER) / cols;
  const COLW = Math.min(COLW_MAX, Math.max(COLW_MIN, fluid));
  const xs = Array.from({ length: cols }, (_, i) => i * (COLW + GUTTER));
  const box = new Map<string, CardBox & { col: number }>();
  let bottom = TOP + CARDH;
  for (const n of model.nodes) {
    const b = { x: xs[n.column] ?? 0, y: TOP + n.row * PITCH, w: COLW, h: CARDH, col: n.column };
    box.set(n.id, b);
    bottom = Math.max(bottom, b.y + b.h);
  }
  const free = (col: number, y: number) =>
    ![...box.values()].some((b) => b.col === col && b.y - 6 <= y && y <= b.y + b.h + 6);
  const paths = new Map<string, string>();
  let channels = 0;
  for (const e of model.edges) {
    const a = box.get(e.from);
    const b = box.get(e.to);
    if (!a || !b) continue;
    const x1 = a.x + a.w;
    const y1 = a.y + a.h / 2;
    const x2 = b.x;
    const y2 = b.y + b.h / 2;
    let d: string;
    const mids = Array.from({ length: Math.max(0, b.col - a.col - 1) }, (_, i) => a.col + 1 + i);
    if (b.col <= a.col + 1) {
      d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} ${bez(x1, y1, x2, y2)}`;
    } else if (mids.every((c) => free(c, y1))) {
      d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} L ${(x2 - GUTTER).toFixed(1)} ${y1.toFixed(1)} ${bez(x2 - GUTTER, y1, x2, y2)}`;
    } else if (mids.every((c) => free(c, y2))) {
      d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} ${bez(x1, y1, x1 + GUTTER, y2)} L ${x2.toFixed(1)} ${y2.toFixed(1)}`;
    } else {
      // Orthogonal route through a free channel below everything (gen.py channel).
      const yc = bottom + 16 + channels * 8;
      channels += 1;
      const r = 8;
      const p = x1 + GUTTER / 2;
      const q = x2 - GUTTER / 2;
      const f = (v: number) => v.toFixed(1);
      d =
        `M ${f(x1)} ${f(y1)} H ${f(p - r)} Q ${f(p)} ${f(y1)} ${f(p)} ${f(y1 + r)} V ${f(yc - r)} Q ${f(p)} ${f(yc)} ${f(p + r)} ${f(yc)} ` +
        `H ${f(q - r)} Q ${f(q)} ${f(yc)} ${f(q)} ${f(yc - r)} V ${f(y2 + r)} Q ${f(q)} ${f(y2)} ${f(q + r)} ${f(y2)} H ${f(x2)}`;
    }
    paths.set(`${e.from}>${e.to}`, d);
  }
  const width = (xs[cols - 1] ?? 0) + COLW;
  const height = bottom + 24 + channels * 8;
  return { cols, colW: COLW, width, height, bottom, xs, box, paths };
}

// ------------------------------------------------------------ chain state

export function edgeLit(focus: Focus | null, chain: Chain | null, from: string, to: string): EdgeLit {
  if (focus === null || chain === null) return 'idle';
  const onUp = chain.up.has(from) && (chain.up.has(to) || to === focus.id);
  const onDown = (from === focus.id || chain.down.has(from)) && chain.down.has(to);
  if (focus.mode === 'select') return onUp || onDown ? 'held' : 'faint';
  if (focus.mode === 'answer') return onDown ? 'wave' : 'faint';
  if (onUp) return 'toward';
  if (onDown) return 'away';
  return 'faint';
}

export function cardTone(focus: Focus | null, chain: Chain | null, id: string): CardTone {
  if (focus === null || chain === null) return 'none';
  if (focus.mode === 'card') {
    if (id === focus.id) return 'hover';
    if (chain.downNow.has(id)) return 'near';
    if (chain.down.has(id)) return 'far';
  }
  if (focus.mode === 'answer' && chain.downNow.has(id)) return 'go';
  return 'none';
}

// ------------------------------------------------------------ view

/** Hover leave is delayed ~80 ms: a pointer grazing a card edge must not
 *  flicker the lit chain on and off (owner review 16.11). */
export const HOVER_LEAVE_MS = 80;
export function useHoverFocus(): {
  hover: Focus | null;
  enter: (f: SetStateAction<Focus | null>) => void;
  leave: () => void;
  onCardHover: (id: string | null) => void;
  onAnswerHover: (id: string | null) => void;
} {
  const [hover, setHover] = useState<Focus | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  const enter = (f: SetStateAction<Focus | null>) => {
    cancel();
    setHover(f);
  };
  const leave = () => {
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      setHover(null);
    }, HOVER_LEAVE_MS);
  };
  const onCardHover = (id: string | null) => (id === null ? leave() : enter({ id, mode: 'card' }));
  const onAnswerHover = (id: string | null) =>
    id !== null ? enter({ id, mode: 'answer' }) : enter((h) => (h !== null ? { id: h.id, mode: 'card' } : null));
  return { hover, enter, leave, onCardHover, onAnswerHover };
}

/** Always-present one-line banner slot: hover fills it, never resizes it. */
export function BannerSlot({ text, mode, testId }: { text: string | null; mode: Mode | null; testId: string }) {
  return (
    <div className="vkg-banner" role="status" data-testid={testId} data-kind={mode === 'answer' ? 'answer' : 'task'} data-empty={text === null ? 'true' : 'false'}>
      {text !== null ? (
        <>
          <p title={text}>{text}</p>
          {mode === 'answer' ? <span className="vkg-tag" aria-hidden="true">предпросмотр</span> : null}
        </>
      ) : null}
    </div>
  );
}

export function GraphView({ model, selectedId, onSelect, onAnswer }: GraphViewProps) {
  const { hover, leave, onCardHover, onAnswerHover } = useHoverFocus();
  const reduced = useReducedMotion();
  const [scrollRef, avail] = useContentWidth<HTMLDivElement>();
  const layout = useMemo(() => layoutGraph(model, avail), [model, avail]);
  const known = (id: string | null) => id !== null && model.nodes.some((n) => n.id === id);

  const focus: Focus | null =
    hover !== null && known(hover.id)
      ? hover
      : selectedId !== null && known(selectedId)
        ? { id: selectedId, mode: 'select' }
        : null;
  const chain = useMemo(() => (focus === null ? null : chainOf(model, focus.id)), [model, focus?.id]);
  const banner = focus === null ? null : whatIfBanner(model, focus.id);

  const colOf = new Map(model.nodes.map((n) => [n.id, n.column]));
  const lit = model.edges.map((e) => ({ e, lit: edgeLit(focus, chain, e.from, e.to) }));
  const moving = lit.filter((x) => x.lit === 'toward' || x.lit === 'away' || x.lit === 'wave');
  const firstCol = moving.reduce((m, x) => Math.min(m, colOf.get(x.e.from) ?? 0), Infinity);
  const finishX = layout.cols > 1 ? (layout.xs[layout.cols - 1] ?? 0) - GUTTER / 2 : null;

  return (
    <section className="vkg" aria-label="Граф эпика">
      <div
        className="vkg-desk hidden md:block"
        data-testid="graph-desktop"
        data-motion={reduced ? 'off' : 'on'}
        onMouseLeave={leave}
      >
        {/* Fixed head: the headline stays, the banner fills its own one-line slot, so hover never moves the graph. */}
        <div className="vkg-head" data-testid="graph-head">
          <div className="vkg-concl">
            <p className="vkg-concl-1">{model.headline}</p>
            <p className="vkg-concl-2">{model.subline}</p>
          </div>
          <BannerSlot text={banner} mode={focus?.mode ?? null} testId="graph-banner" />
        </div>
        <div className="vkg-scroll" ref={scrollRef}>
          <div className="vkg-canvas" style={{ width: layout.width, height: layout.height }}>
            {model.columns.map((c, i) => (
              <div
                key={`${i}-${c.title}`}
                className="vkg-colhead"
                style={{ left: layout.xs[i] ?? 0, width: layout.colW }}
                data-testid={`graph-col-${c.title}`}
              >
                <div className="vkg-colhead-bar">
                  <span aria-hidden="true" className="vkg-dot" style={{ background: columnColor(i, model.columns.length) }} />
                  <p>{c.title}</p>
                  <span className="vkg-colhead-count">{c.count}</span>
                </div>
                <div className="vkg-verdict" data-alarm={c.alarm ? 'true' : 'false'}>
                  {c.alarm ? <GraphIcon name="clock" size={13} /> : null}
                  {/* two lines at most: a third ran into the first card (live M04) */}
                  <span className="vkg-verdict-text" title={c.verdict}>
                    {c.verdict}
                  </span>
                </div>
              </div>
            ))}
            <svg
              aria-hidden="true"
              width={layout.width}
              height={layout.height}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', zIndex: 0, pointerEvents: 'none' }}
            >
              {lit.map(({ e, lit: l }) => {
                const key = `${e.from}>${e.to}`;
                const d = layout.paths.get(key);
                if (d === undefined) return null;
                const phase = Math.max(0, (colOf.get(e.from) ?? 0) - (Number.isFinite(firstCol) ? firstCol : 0));
                const step = l === 'wave' ? 0.765 : 1;
                return (
                  <Fragment key={key}>
                    <path className="vkg-edge" data-edge={key} data-lit={l} d={d} />
                    {l === 'held' ? <path className="vkg-held" d={d} /> : null}
                    {l === 'toward' || l === 'away' || l === 'wave' ? (
                      <path
                        className="vkg-flow"
                        data-kind={l === 'wave' ? 'wave' : 'flow'}
                        pathLength={100}
                        d={d}
                        style={{ animationDelay: `${(phase * step).toFixed(2)}s` }}
                      />
                    ) : null}
                  </Fragment>
                );
              })}
            </svg>
            {finishX !== null ? (
              <div
                aria-hidden="true"
                className="vkg-finish"
                style={{ left: finishX, top: TOP, height: Math.max(0, layout.bottom - TOP) }}
              />
            ) : null}
            {model.nodes.map((n) => {
              const box = layout.box.get(n.id) as CardBox;
              const inChain = chain !== null && focus !== null && (n.id === focus.id || chain.up.has(n.id) || chain.down.has(n.id));
              const shell = {
                node: n,
                box,
                selected: n.id === selectedId,
                dim: focus !== null && !inChain,
                tone: cardTone(focus, chain, n.id),
                onSelect,
                onHover: onCardHover,
              };
              return n.kind === 'question' ? (
                <QuestionCard key={n.id} {...shell} onAnswer={onAnswer} onAnswerHover={onAnswerHover} />
              ) : (
                <GraphCard key={n.id} {...shell} />
              );
            })}
          </div>
        </div>
      </div>
      <PhoneWaves model={model} selectedId={selectedId} onSelect={onSelect} onAnswer={onAnswer} />
    </section>
  );
}

// ------------------------------------------------------------ phone

const PHONE_SHOWN = 2;

function PhoneWaves({ model, selectedId, onSelect, onAnswer }: GraphViewProps) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const byCol = (c: number): GraphNode[] =>
    model.nodes.filter((n) => n.column === c).sort((a, b) => a.row - b.row);
  return (
    <div className="md:hidden" data-testid="graph-phone">
      <div className="vkg-phone-head">
        <p>{model.headline}</p>
        <p>{model.subline}</p>
      </div>
      {model.columns.map((c, i) => {
        const nodes = byCol(i);
        const tasks = nodes.filter((n) => n.kind === 'task');
        const collapse = tasks.length > PHONE_SHOWN + 1 && !open.has(i) && !tasks.some((t) => t.id === selectedId);
        const hidden = collapse ? tasks.slice(PHONE_SHOWN) : [];
        const visible = nodes.filter((n) => !hidden.includes(n));
        return (
          <div key={`${i}-${c.title}`} data-wave-title={c.title}>
            <div className="vkg-wave">
              <span aria-hidden="true" className="vkg-dot" style={{ background: columnColor(i, model.columns.length) }} />
              <span className="vkg-wave-name">{c.title}</span>
              <span className="vkg-colhead-count">{c.count}</span>
            </div>
            <div className="vkg-wave-verdict" data-alarm={c.alarm ? 'true' : 'false'}>
              {c.alarm ? <GraphIcon name="clock" /> : null}
              <span>{c.verdict}</span>
            </div>
            {visible.map((n) =>
              n.kind === 'question' ? (
                <div
                  key={n.id}
                  className="vkg-qrow"
                  data-node-id={n.id}
                  aria-current={n.id === selectedId ? 'true' : undefined}
                  onClick={() => onSelect(n.id)}
                >
                  <span style={{ color: 'oklch(var(--warn))', display: 'flex' }}>
                    <GraphIcon name="hand" size={16} />
                  </span>
                  {/* 390 px: label over title; side by side both were cut to «во…» */}
                  <span className="vkg-qrow-text">
                    <span className="vkg-label vkg-qrow-label">{n.label}</span>
                    <span className="vkg-qrow-title">{n.title}</span>
                    <span style={{ fontSize: 13, color: 'oklch(var(--vk-text-low))' }}>держит {n.holds}</span>
                  </span>
                  <button
                    type="button"
                    className="vkg-answer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAnswer(n.id);
                    }}
                  >
                    Ответить
                  </button>
                </div>
              ) : (
                <button
                  key={n.id}
                  type="button"
                  className="vkg-prow"
                  data-node-id={n.id}
                  data-outside={n.outside ? 'true' : 'false'}
                  aria-current={n.id === selectedId ? 'true' : undefined}
                  onClick={() => onSelect(n.id)}
                >
                  <span className="vkg-row">
                    <StateDot state={n.state} />
                    <span className="vkg-label">{n.label}</span>
                  </span>
                  <span className="vkg-title">{n.title}</span>
                  <span className="vkg-row" style={{ justifyContent: 'space-between', width: '100%' }}>
                    <span className="vkg-row" style={{ gap: 4 }}>
                      {n.reason ? <ReasonChip state={n.state} text={n.reason} size={14} /> : null}
                    </span>
                    <Avatar assignee={n.assignee} />
                  </span>
                </button>
              ),
            )}
            {hidden.length > 0 ? (
              <button type="button" className="vkg-more" onClick={() => setOpen((s) => new Set(s).add(i))}>
                <GraphIcon name="down" />
                Ещё {hidden.length}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
