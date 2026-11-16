import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BoardGraph, Lane } from './boardModel';
import { Avatar, GraphCard, ReasonChip, StateDot, type CardBox } from './GraphCard';
import { GraphIcon } from './icons';
import { bez, cardTone, columnColor, edgeLit, useReducedMotion, type Focus } from './GraphView';
import { chainOf, whatIfBanner, type GraphNode } from './model';
import { QuestionCard } from './QuestionCard';
import './graph.css';
import './boardGraph.css';

// «Эпик: Все» + «Граф» (16.11, ALL-README). Epics are lanes (rows, plan
// order, sticky labels), waves are global columns (sticky headers), the
// owner's questions share one «От тебя» column. Drafts without a plan are
// one-line summary rows. Lines that cross lanes run in the gutters between
// lanes. Hover / click are the per-epic V1 / V5; when part of a lit chain is
// off screen, «↓ ещё N ниже» / «→ ещё N правее» scroll there.
//
// Shared with GraphView.tsx: bez, columnColor, useReducedMotion, edgeLit,
// cardTone (exported there).

export interface BoardGraphViewProps {
  graph: BoardGraph;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAnswer: (questionId: string) => void;
  onToggleLane: (key: string) => void;
  onOpenEpic: (key: string) => void;
}

export const ASK = 'ask';
const COL_MIN = 190;
const COL_MAX = 380;
const LABELW = 168;
const X0 = LABELW + 12;
const PAD_R = 16;
const GUTTER = 26;
const CARDH = 90;
const PITCH = 102;
const LANE_PAD = 10;
const LANE_GAP = 22;
const SUMMARY_H = 40;
export const COLHEAD_H = 100;

/** «M05, M06 … M12» → «M05–M12»; anything else is listed. */
export function epicRange(keys: ReadonlyArray<string>): string {
  const nums = keys.map((k) => /^M(\d+)$/u.exec(k));
  if (keys.length > 2 && nums.every((m) => m !== null)) {
    const v = nums.map((m) => Number(m![1]));
    if (v.every((x, i) => i === 0 || x === v[i - 1]! + 1)) return `${keys[0]}–${keys[keys.length - 1]}`;
  }
  return keys.join(', ');
}

function tasksWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'задача';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'задачи';
  return 'задач';
}

// ------------------------------------------------------------ layout

export interface LaneBox {
  key: string;
  top: number;
  height: number;
  collapsed: boolean;
}
type Box = CardBox & { col: number; lane: string };
export type Route = 'direct' | 'gutter';
export interface BoardLayout {
  colW: number;
  cols: number;
  xs: number[];
  width: number;
  height: number;
  lanes: LaneBox[];
  box: Map<string, Box>;
  paths: Map<string, string>;
  routes: Map<string, Route>;
}

/** Orthogonal polyline with rounded corners. */
function ortho(pts: ReadonlyArray<[number, number]>): string {
  const f = (v: number) => v.toFixed(1);
  let d = `M ${f(pts[0]![0])} ${f(pts[0]![1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1]!;
    const [cx, cy] = pts[i]!;
    const [nx, ny] = pts[i + 1]!;
    const r = Math.min(8, Math.hypot(cx - px, cy - py) / 2, Math.hypot(nx - cx, ny - cy) / 2);
    const ax = cx - Math.sign(cx - px) * r;
    const ay = cy - Math.sign(cy - py) * r;
    const bx = cx + Math.sign(nx - cx) * r;
    const by = cy + Math.sign(ny - cy) * r;
    d += ` L ${f(ax)} ${f(ay)} Q ${f(cx)} ${f(cy)} ${f(bx)} ${f(by)}`;
  }
  const last = pts[pts.length - 1]!;
  return `${d} L ${f(last[0])} ${f(last[1])}`;
}

export function layoutBoard(graph: BoardGraph, avail: number): BoardLayout {
  const maxCol = graph.nodes.reduce((m, n) => Math.max(m, n.column), 0);
  const cols = Math.max(graph.columns.length, maxCol + 1, 1);
  const fluid = (avail - X0 - PAD_R - (cols - 1) * GUTTER) / cols;
  const colW = Math.min(COL_MAX, Math.max(COL_MIN, Number.isFinite(fluid) ? fluid : COL_MIN));
  const xs = Array.from({ length: cols }, (_, i) => X0 + i * (colW + GUTTER));
  const width = X0 + cols * colW + (cols - 1) * GUTTER + PAD_R;

  const byLane = new Map<string, GraphNode[]>();
  for (const n of graph.nodes) {
    const k = graph.laneOf[n.id];
    if (k === undefined) continue;
    byLane.set(k, [...(byLane.get(k) ?? []), n]);
  }

  const box = new Map<string, Box>();
  const lanes: LaneBox[] = [];
  const proxy = new Map<string, Box>(); // hidden node -> its lane's summary row
  let cursor = LANE_GAP;
  for (const lane of graph.lanes) {
    const nodes = byLane.get(lane.key) ?? [];
    const top = cursor;
    let height: number;
    if (lane.collapsed || nodes.length === 0) {
      height = SUMMARY_H;
      for (const n of nodes) proxy.set(n.id, { x: xs[n.column] ?? X0, y: top, w: colW, h: SUMMARY_H, col: n.column, lane: lane.key });
    } else {
      const rows = nodes.reduce((m, n) => Math.max(m, n.row), 0) + 1;
      height = LANE_PAD * 2 + (rows - 1) * PITCH + CARDH;
      for (const n of nodes) {
        box.set(n.id, { x: xs[n.column] ?? X0, y: top + LANE_PAD + n.row * PITCH, w: colW, h: CARDH, col: n.column, lane: lane.key });
      }
    }
    lanes.push({ key: lane.key, top, height, collapsed: lane.collapsed || nodes.length === 0 });
    cursor += height + LANE_GAP;
  }
  let bottom = cursor;
  for (const n of byLane.get(ASK) ?? []) {
    const b = { x: xs[0] ?? X0, y: LANE_GAP + LANE_PAD + n.row * PITCH, w: colW, h: CARDH, col: n.column, lane: ASK };
    box.set(n.id, b);
    bottom = Math.max(bottom, b.y + b.h + LANE_GAP);
  }

  const laneBox = new Map(lanes.map((l) => [l.key, l]));
  const free = (lane: string, col: number, y: number) =>
    ![...box.values()].some((b) => b.lane === lane && b.col === col && b.y - 6 <= y && y <= b.y + b.h + 6);
  const paths = new Map<string, string>();
  const routes = new Map<string, Route>();
  const gutterUse = new Map<number, number>();
  for (const e of graph.edges) {
    const a = box.get(e.from) ?? proxy.get(e.from);
    const b = box.get(e.to) ?? proxy.get(e.to);
    if (!a || !b) continue;
    const key = `${e.from}>${e.to}`;
    const x1 = a.x + a.w;
    const y1 = a.y + a.h / 2;
    const x2 = b.x;
    const y2 = b.y + b.h / 2;
    const mids = Array.from({ length: Math.max(0, b.col - a.col - 1) }, (_, i) => a.col + 1 + i);
    if (a.lane === b.lane && a.lane !== ASK && b.col > a.col) {
      if (b.col === a.col + 1) {
        paths.set(key, `M ${x1.toFixed(1)} ${y1.toFixed(1)} ${bez(x1, y1, x2, y2)}`);
        routes.set(key, 'direct');
        continue;
      }
      if (mids.every((c) => free(a.lane, c, y1))) {
        paths.set(key, `M ${x1.toFixed(1)} ${y1.toFixed(1)} L ${(x2 - GUTTER).toFixed(1)} ${y1.toFixed(1)} ${bez(x2 - GUTTER, y1, x2, y2)}`);
        routes.set(key, 'direct');
        continue;
      }
    }
    // Through a gutter between lanes: the one bordering the target lane on
    // the side the line comes from (for a same-lane detour, below the lane).
    const tl = laneBox.get(b.lane);
    let yc: number;
    if (tl === undefined) yc = bottom - LANE_GAP / 2;
    else if (a.lane === b.lane) yc = tl.top + tl.height + LANE_GAP / 2;
    else yc = y1 < tl.top ? tl.top - LANE_GAP / 2 : tl.top + tl.height + LANE_GAP / 2;
    const k = gutterUse.get(yc) ?? 0;
    gutterUse.set(yc, k + 1);
    yc += ((k % 3) - 1) * 4;
    const p = x1 + GUTTER / 2;
    const q = x2 - GUTTER / 2;
    paths.set(
      key,
      ortho([
        [x1, y1],
        [p, y1],
        [p, yc],
        [q, yc],
        [q, y2],
        [x2, y2],
      ]),
    );
    routes.set(key, 'gutter');
  }
  return { colW, cols, xs, width, height: bottom, lanes, box, paths, routes };
}

// ------------------------------------------------------------ chain state

// ------------------------------------------------------------ desktop

interface Viewport {
  left: number;
  top: number;
  w: number;
  h: number;
}

type Sized<T> = readonly [ref: React.RefObject<T>, width: number];

function useWidth<T extends HTMLElement>(): Sized<T> {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => {
        const cw = entries[0]?.contentRect.width;
        if (cw !== undefined) setW(cw);
      });
      ro.observe(el);
      return () => ro.disconnect();
    }
    const on = () => setW(el.clientWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return [ref, w];
}

export function BoardGraphView(props: BoardGraphViewProps) {
  const { graph, selectedId, onSelect, onAnswer, onToggleLane, onOpenEpic } = props;
  const [hover, setHover] = useState<Focus | null>(null);
  const [fit, setFit] = useState(false);
  const [vp, setVp] = useState<Viewport>({ left: 0, top: 0, w: 0, h: 0 });
  const reduced = useReducedMotion();
  const [deskRef, avail] = useWidth<HTMLDivElement>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => layoutBoard(graph, avail), [graph, avail]);
  const fullH = COLHEAD_H + layout.height;

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (el === null) return;
    setVp({ left: el.scrollLeft, top: el.scrollTop, w: el.clientWidth, h: el.clientHeight });
  }, []);

  const scale = useMemo(() => {
    if (!fit) return 1;
    const el = scrollRef.current;
    const w = el?.clientWidth ?? 0;
    const h = el?.clientHeight ?? 0;
    if (w <= 0) return 1;
    return Math.max(0.05, Math.min(1, w / layout.width, h > 0 ? h / fullH : 1));
  }, [fit, layout.width, fullH]);

  useEffect(measure, [fit, layout, measure]);

  const known = (id: string | null) => id !== null && layout.box.has(id);
  const focus: Focus | null =
    hover !== null && known(hover.id)
      ? hover
      : selectedId !== null && graph.nodes.some((n) => n.id === selectedId)
        ? { id: selectedId, mode: 'select' }
        : null;
  const chain = useMemo(() => (focus === null ? null : chainOf(graph, focus.id)), [graph, focus?.id]);
  const banner = focus === null ? null : whatIfBanner(graph, focus.id);

  // Search / outside select: bring the selected card into view.
  useEffect(() => {
    const el = scrollRef.current;
    const b = selectedId === null ? undefined : layout.box.get(selectedId);
    if (el === null || b === undefined || el.clientWidth <= 0) return;
    const x = b.x * scale;
    const y = (COLHEAD_H + b.y) * scale;
    const offX = x < el.scrollLeft + X0 || x + b.w * scale > el.scrollLeft + el.clientWidth;
    const offY = y < el.scrollTop + COLHEAD_H || y + b.h * scale > el.scrollTop + el.clientHeight;
    if (offX) el.scrollLeft = Math.max(0, x - X0 - GUTTER);
    if (offY) el.scrollTop = Math.max(0, y - COLHEAD_H - LANE_GAP);
    if (offX || offY) measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Off-screen parts of the lit chain.
  const lit = focus !== null && chain !== null ? [focus.id, ...chain.up, ...chain.down] : [];
  const litBoxes = lit.map((id) => layout.box.get(id)).filter((b): b is Box => b !== undefined);
  const below = vp.w > 0 ? litBoxes.filter((b) => (COLHEAD_H + b.y) * scale > vp.top + vp.h) : [];
  const right = vp.w > 0 ? litBoxes.filter((b) => b.x * scale > vp.left + vp.w) : [];
  const jumpDown = () => {
    const el = scrollRef.current;
    if (el === null || below.length === 0) return;
    const y = Math.min(...below.map((b) => b.y));
    el.scrollTop = Math.max(1, y * scale - LANE_GAP);
    measure();
  };
  const jumpRight = () => {
    const el = scrollRef.current;
    if (el === null || right.length === 0) return;
    const x = Math.min(...right.map((b) => b.x));
    el.scrollLeft = Math.max(1, x * scale - X0 - GUTTER);
    measure();
  };

  const onCardHover = (id: string | null) => setHover(id === null ? null : { id, mode: 'card' });
  const onAnswerHover = (id: string | null) =>
    setHover((h) => (id !== null ? { id, mode: 'answer' } : h !== null ? { id: h.id, mode: 'card' } : null));

  const colOf = new Map(graph.nodes.map((n) => [n.id, n.column]));
  const edges = graph.edges.map((e) => ({ e, lit: edgeLit(focus, chain, e.from, e.to) }));
  const moving = edges.filter((x) => x.lit === 'toward' || x.lit === 'away' || x.lit === 'wave');
  const firstCol = moving.reduce((m, x) => Math.min(m, colOf.get(x.e.from) ?? 0), Infinity);
  const laneByKey = new Map(graph.lanes.map((l) => [l.key, l]));

  return (
    <section className="vkg vkgb" aria-label="Граф всех задач">
      <div
        ref={deskRef}
        className="vkg-desk vkgb-desk hidden md:block"
        data-testid="board-desktop"
        data-motion={reduced ? 'off' : 'on'}
        onMouseLeave={() => setHover(null)}
      >
        {graph.warnings.length > 0 ? (
          <div className="vkgb-warn" role="alert">
            {graph.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        ) : null}
        <div className="vkgb-top">
          {banner !== null && focus !== null ? (
            <div className="vkg-banner" role="status" data-kind={focus.mode === 'answer' ? 'answer' : 'task'}>
              <p>{banner}</p>
              {focus.mode === 'answer' ? <span className="vkg-tag" aria-hidden="true">предпросмотр</span> : null}
            </div>
          ) : (
            <div className="vkg-concl">
              <p className="vkg-concl-1">{graph.headline}</p>
              <p className="vkg-concl-2">{graph.subline}</p>
            </div>
          )}
          <button
            type="button"
            className="vkgb-fit"
            aria-pressed={fit}
            onClick={() => {
              setFit((f) => !f);
            }}
          >
            {fit ? 'обычный масштаб' : 'вписать в экран'}
          </button>
        </div>
        <div className="vkgb-viewport">
          <div ref={scrollRef} className="vkgb-scroll" data-testid="board-scroll" onScroll={measure}>
            <div className="vkgb-sizer" style={{ width: layout.width * scale, height: fullH * scale }}>
              <div
                className="vkgb-canvas"
                data-testid="board-canvas"
                data-fit={fit ? 'on' : 'off'}
                style={{ width: layout.width, transform: fit ? `scale(${scale.toFixed(3)})` : undefined }}
              >
                <div className="vkgb-colheads vkgb-sticky-top" data-testid="board-colheads" style={{ height: COLHEAD_H, width: layout.width }}>
                  <div className="vkgb-corner vkgb-sticky-left" style={{ width: LABELW }}>
                    {graph.lanes.length} эпиков
                  </div>
                  {graph.columns.map((c, i) => (
                    <div
                      key={`${i}-${c.title}`}
                      className="vkg-colhead vkgb-colhead"
                      data-testid={`board-col-${i}`}
                      style={{ left: layout.xs[i] ?? 0, width: layout.colW }}
                    >
                      <div className="vkg-colhead-bar">
                        <span aria-hidden="true" className="vkg-dot" style={{ background: columnColor(i, graph.columns.length) }} />
                        <p>{c.title}</p>
                        <span className="vkg-colhead-count">{c.count}</span>
                      </div>
                      <div className="vkg-verdict" data-alarm={c.alarm ? 'true' : 'false'}>
                        {c.alarm ? <GraphIcon name="clock" size={13} /> : null}
                        <span className="vkg-verdict-text" title={c.verdict}>
                          {c.verdict}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="vkgb-body" style={{ height: layout.height, width: layout.width }}>
                  {layout.lanes.map((lb) => {
                    const lane = laneByKey.get(lb.key) as Lane;
                    return (
                      <div
                        key={lb.key}
                        className="vkgb-lane"
                        data-testid={`board-lane-${lb.key}`}
                        data-collapsed={lb.collapsed ? 'true' : 'false'}
                        style={{ top: lb.top, height: lb.height, width: layout.width }}
                      >
                        <LaneLabel lane={lane} onToggleLane={onToggleLane} onOpenEpic={onOpenEpic} />
                        {lane.collapsed ? (
                          <button
                            type="button"
                            className="vkgb-summary"
                            data-testid={`board-summary-${lane.key}`}
                            style={{ left: layout.xs[1] ?? X0, height: SUMMARY_H - 8 }}
                            onClick={() => onToggleLane(lane.key)}
                          >
                            {lane.title} · {lane.total} {tasksWord(lane.total)} · {lane.approved ? 'свёрнуто' : 'план не одобрен'}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                  <svg
                    aria-hidden="true"
                    width={layout.width}
                    height={layout.height}
                    viewBox={`0 0 ${layout.width} ${layout.height}`}
                    style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', zIndex: 1 }}
                  >
                    {edges.map(({ e, lit: l }) => {
                      const key = `${e.from}>${e.to}`;
                      const d = layout.paths.get(key);
                      if (d === undefined) return null;
                      const phase = Math.max(0, (colOf.get(e.from) ?? 0) - (Number.isFinite(firstCol) ? firstCol : 0));
                      const step = l === 'wave' ? 0.765 : 1;
                      return (
                        <Fragment key={key}>
                          <path className="vkg-edge" data-edge={key} data-lit={l} data-route={layout.routes.get(key)} d={d} />
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
                  {graph.nodes.map((n) => {
                    const box = layout.box.get(n.id);
                    if (box === undefined) return null;
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
          </div>
          {below.length > 0 ? (
            <button type="button" className="vkgb-hint" data-dir="down" onClick={jumpDown}>
              ↓ ещё {below.length} ниже
            </button>
          ) : null}
          {right.length > 0 ? (
            <button type="button" className="vkgb-hint" data-dir="right" onClick={jumpRight}>
              → ещё {right.length} правее
            </button>
          ) : null}
        </div>
      </div>
      <BoardPhone {...props} />
    </section>
  );
}

function LaneLabel({ lane, onToggleLane, onOpenEpic }: { lane: Lane; onToggleLane: (k: string) => void; onOpenEpic: (k: string) => void }) {
  return (
    <div className="vkgb-lane-label vkgb-sticky-left" data-testid={`board-lane-label-${lane.key}`} style={{ width: LABELW }}>
      <div className="vkg-row">
        <button
          type="button"
          className="vkgb-toggle"
          aria-label={`${lane.collapsed ? 'Развернуть' : 'Свернуть'} ${lane.title}`}
          aria-expanded={!lane.collapsed}
          onClick={() => onToggleLane(lane.key)}
        >
          <span aria-hidden="true">{lane.collapsed ? '▸' : '▾'}</span>
        </button>
        <button type="button" className="vkgb-epic" title="Открыть граф эпика" onClick={() => onOpenEpic(lane.key)}>
          {lane.title}
        </button>
      </div>
      <span className="vkgb-progress">
        {lane.done} из {lane.total}
      </span>
      {lane.waitsOnEpics.length > 0 ? <span className="vkgb-waits">ждёт {epicRange(lane.waitsOnEpics)}</span> : null}
    </div>
  );
}

// ------------------------------------------------------------ phone

function PhoneRow({ n, selectedId, onSelect, onAnswer }: { n: GraphNode } & Pick<BoardGraphViewProps, 'selectedId' | 'onSelect' | 'onAnswer'>) {
  if (n.kind === 'question') {
    return (
      <div className="vkg-qrow" data-node-id={n.id} aria-current={n.id === selectedId ? 'true' : undefined} onClick={() => onSelect(n.id)}>
        <span style={{ color: 'oklch(var(--warn))', display: 'flex' }}>
          <GraphIcon name="hand" size={16} />
        </span>
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
    );
  }
  return (
    <div
      role="link"
      tabIndex={0}
      className="vkg-prow"
      data-node-id={n.id}
      data-outside={n.outside ? 'true' : 'false'}
      aria-current={n.id === selectedId ? 'true' : undefined}
      onClick={() => onSelect(n.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(n.id);
        }
      }}
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
    </div>
  );
}

function BoardPhone({ graph, selectedId, onSelect, onAnswer }: BoardGraphViewProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (l: Lane) => open[l.key] ?? (!l.collapsed || l.nodeIds.includes(selectedId ?? ''));
  const inLane = (k: string) => graph.nodes.filter((n) => graph.laneOf[n.id] === k);
  const questions = inLane(ASK).sort((a, b) => a.row - b.row);
  return (
    <div className="md:hidden vkgb-phone" data-testid="board-phone">
      <div className="vkg-phone-head">
        <p>{graph.headline}</p>
        <p>{graph.subline}</p>
      </div>
      {graph.warnings.map((w) => (
        <p key={w} className="vkgb-warn">
          {w}
        </p>
      ))}
      {questions.length > 0 ? (
        <div data-testid="board-phone-ask">
          <div className="vkg-wave">
            <span aria-hidden="true" className="vkg-dot" style={{ background: columnColor(0, 2) }} />
            <span className="vkg-wave-name">{graph.columns[0]?.title ?? 'От тебя'}</span>
            <span className="vkg-colhead-count">{questions.length}</span>
          </div>
          {questions.map((n) => (
            <PhoneRow key={n.id} n={n} selectedId={selectedId} onSelect={onSelect} onAnswer={onAnswer} />
          ))}
        </div>
      ) : null}
      {graph.lanes.map((l) => {
        const expanded = isOpen(l);
        const nodes = inLane(l.key);
        const waves = [...new Set(nodes.map((n) => n.column))].sort((a, b) => a - b);
        return (
          <div key={l.key} data-testid={`board-phone-lane-${l.key}`} className="vkgb-plane">
            <button
              type="button"
              className="vkgb-phead"
              aria-expanded={expanded}
              aria-label={`Эпик ${l.title}, ${l.done} из ${l.total}${l.approved ? '' : ', план не одобрен'}`}
              onClick={() => setOpen((o) => ({ ...o, [l.key]: !expanded }))}
            >
              <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
              <span className="vkgb-epic">{l.title}</span>
              <span className="vkgb-progress">
                {l.done} из {l.total}
              </span>
              {!l.approved ? <span className="vkgb-waits">план не одобрен</span> : null}
              {l.waitsOnEpics.length > 0 ? <span className="vkgb-waits">ждёт {epicRange(l.waitsOnEpics)}</span> : null}
            </button>
            {expanded
              ? waves.map((c) => (
                  <div key={c} data-wave-title={graph.columns[c]?.title}>
                    <div className="vkg-wave">
                      <span aria-hidden="true" className="vkg-dot" style={{ background: columnColor(c, graph.columns.length) }} />
                      <span className="vkg-wave-name">{graph.columns[c]?.title ?? `волна ${c}`}</span>
                    </div>
                    {nodes
                      .filter((n) => n.column === c)
                      .sort((a, b) => a.row - b.row)
                      .map((n) => (
                        <PhoneRow key={n.id} n={n} selectedId={selectedId} onSelect={onSelect} onAnswer={onAnswer} />
                      ))}
                  </div>
                ))
              : null}
          </div>
        );
      })}
    </div>
  );
}
