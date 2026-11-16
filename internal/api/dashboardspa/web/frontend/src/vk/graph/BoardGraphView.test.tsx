import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardGraphView, COLHEAD_H, layoutBoard, epicRange, fitScale } from './BoardGraphView';
import type { BoardGraph, Lane } from './boardModel';
import type { GraphNode } from './model';

// allv lane (16.11 «Эпик: Все» + «Граф»): lanes, global waves, the shared
// «От тебя» column, collapse rows, gutter lines, V1/V5, off-screen hints,
// «вписать в экран», phone accordion.

function n(id: string, kind: GraphNode['kind'], label: string, column: number, row: number, extra: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    kind,
    label,
    title: `${label} title`,
    state: kind === 'question' ? 'waits_owner' : 'waits_task',
    reason: '',
    holds: 0,
    column,
    row,
    outside: false,
    assignee: null,
    ...extra,
  };
}

function lane(key: string, nodeIds: string[], extra: Partial<Lane> = {}): Lane {
  return { key, title: key, done: 0, total: nodeIds.length, approved: true, collapsed: false, waitsOnEpics: [], nodeIds, ...extra };
}

// q1 (ask) holds M03 #1 and M04 #2 in two lanes; M04 #1 waits on M03 #2
// across lanes; M05 is a collapsed draft; M13 waits on whole epics.
const BOARD: BoardGraph = {
  headline: 'Всё: 7 открытых задач в 4 эпиках.',
  subline: 'Без причины не стоит ничего.',
  warnings: [],
  columns: [
    { title: 'От тебя', count: 1, verdict: '1 вопрос', alarm: false },
    { title: 'Сейчас', count: 2, verdict: 'в работе 1', alarm: false },
    { title: 'Следом', count: 2, verdict: 'ждут M03', alarm: false },
    { title: 'В конце', count: 2, verdict: 'приёмка', alarm: true },
  ],
  nodes: [
    n('q1', 'question', 'вопрос · L1', 0, 0, { holds: 2 }),
    n('a1', 'task', 'M03 #1', 1, 0, { state: 'waits_owner' }),
    n('a2', 'task', 'M03 #2', 2, 0),
    n('b1', 'task', 'M04 #1', 3, 0),
    n('b2', 'task', 'M04 #2', 1, 1, { state: 'in_work', assignee: 'mayor' }),
    n('c1', 'task', 'M05 #1', 2, 0),
    n('d1', 'task', 'M13 #1', 3, 0),
  ],
  edges: [
    { from: 'q1', to: 'a1' },
    { from: 'q1', to: 'b2' },
    { from: 'a1', to: 'a2' },
    { from: 'a2', to: 'b1' },
    { from: 'b2', to: 'b1' },
    { from: 'a2', to: 'c1' },
  ],
  lanes: [
    lane('M03', ['a1', 'a2'], { done: 8, total: 20 }),
    lane('M04', ['b1', 'b2']),
    lane('M05', ['c1'], { approved: false, collapsed: true, total: 9 }),
    lane('M13', ['d1'], { waitsOnEpics: ['M05', 'M06', 'M07', 'M08', 'M09', 'M10', 'M11', 'M12'] }),
  ],
  laneOf: { q1: 'ask', a1: 'M03', a2: 'M03', b1: 'M04', b2: 'M04', c1: 'M05', d1: 'M13' },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(graph: BoardGraph = BOARD, selectedId: string | null = null) {
  const props = {
    onSelect: vi.fn(),
    onAnswer: vi.fn(),
    onToggleLane: vi.fn(),
    onOpenEpic: vi.fn(),
  };
  const utils = render(<BoardGraphView graph={graph} selectedId={selectedId} {...props} />);
  const deskEl = screen.getByTestId('board-desktop');
  const desk = within(deskEl);
  const card = (id: string) => deskEl.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
  const edge = (from: string, to: string) => deskEl.querySelector(`[data-edge="${from}>${to}"]`) as SVGPathElement | null;
  return { ...utils, ...props, deskEl, desk, card, edge };
}

describe('layoutBoard geometry', () => {
  it('columns are fluid: (available − gaps) / columns, clamped to 190–380', () => {
    expect(layoutBoard(BOARD, 0).colW).toBe(190);
    expect(layoutBoard(BOARD, 100000).colW).toBe(380);
    const mid = layoutBoard(BOARD, 1400);
    expect(mid.colW).toBeGreaterThan(190);
    expect(mid.colW).toBeLessThan(380);
    // all columns plus the lane label and gaps fill the available width
    expect(mid.width).toBeLessThanOrEqual(1400);
    expect(mid.width).toBeGreaterThan(1400 - 4);
  });

  it('lanes stack in plan order; a collapsed lane is a short summary row', () => {
    const l = layoutBoard(BOARD, 1400);
    const tops = l.lanes.map((x) => x.top);
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    const m05 = l.lanes.find((x) => x.key === 'M05');
    const m04 = l.lanes.find((x) => x.key === 'M04');
    expect(m05?.collapsed).toBe(true);
    expect(m05!.height).toBeLessThan(m04!.height);
  });

  it('every question sits in the one shared «От тебя» column', () => {
    const l = layoutBoard(BOARD, 1400);
    expect(l.box.get('q1')?.x).toBe(l.xs[0]);
    expect(l.box.get('a1')?.x).toBe(l.xs[1]);
  });

  it('a task sits inside its lane band', () => {
    const l = layoutBoard(BOARD, 1400);
    const m04 = l.lanes.find((x) => x.key === 'M04')!;
    const b = l.box.get('b2')!;
    expect(b.y).toBeGreaterThanOrEqual(m04.top);
    expect(b.y + b.h).toBeLessThanOrEqual(m04.top + m04.height);
  });

  it('cross-lane lines run through the gutter between lanes', () => {
    const l = layoutBoard(BOARD, 1400);
    expect(l.routes.get('a2>b1')).toBe('gutter');
    expect(l.routes.get('q1>b2')).toBe('gutter');
    expect(l.routes.get('a1>a2')).toBe('direct');
  });

  it('a line into a collapsed lane ends at its summary row', () => {
    const l = layoutBoard(BOARD, 1400);
    expect(l.box.has('c1')).toBe(false);
    expect(l.paths.has('a2>c1')).toBe(true);
  });
});

describe('questions stay inside their epic lane', () => {
  const MANY: BoardGraph = {
    ...BOARD,
    nodes: [
      ...BOARD.nodes,
      n('q2', 'question', 'вопрос · L2', 0, 1),
      n('q3', 'question', 'вопрос · L3', 0, 2),
    ],
    edges: [...BOARD.edges, { from: 'q2', to: 'a1' }, { from: 'q3', to: 'a2' }],
    laneOf: { ...BOARD.laneOf, q2: 'ask', q3: 'ask' },
  };

  it('lane height counts the question rows: max(task rows, question rows)', () => {
    const l = layoutBoard(MANY, 1400);
    const m03 = l.lanes.find((x) => x.key === 'M03')!;
    const m04 = l.lanes.find((x) => x.key === 'M04')!;
    for (const id of ['q1', 'q2', 'q3']) {
      const b = l.box.get(id)!;
      expect(b.x).toBe(l.xs[0]);
      expect(b.y).toBeGreaterThanOrEqual(m03.top);
      expect(b.y + b.h).toBeLessThanOrEqual(m03.top + m03.height);
    }
    expect(m04.top).toBeGreaterThanOrEqual(m03.top + m03.height);
  });
});

describe('fitScale', () => {
  it('is min(1, available / graph width), floored at 0.6', () => {
    expect(fitScale(3000, 2000)).toBe(1);
    expect(fitScale(1500, 2000)).toBe(0.75);
    expect(fitScale(400, 2000)).toBe(0.6);
    expect(fitScale(0, 2000)).toBe(1);
  });
});

describe('epicRange', () => {
  it('compresses consecutive milestones into a range', () => {
    expect(epicRange(['M05', 'M06', 'M07', 'M08', 'M09', 'M10', 'M11', 'M12'])).toBe('M05–M12');
    expect(epicRange(['M03', 'Один тип'])).toBe('M03, Один тип');
    expect(epicRange(['M03'])).toBe('M03');
  });
});

describe('BoardGraphView desktop', () => {
  it('renders the headline, global wave headers in a sticky header row, and warnings', () => {
    const { desk, deskEl } = setup({ ...BOARD, warnings: ['цикл: A ⇄ B — поправь связь'] });
    expect(desk.getByText(BOARD.headline)).toBeTruthy();
    const heads = desk.getByTestId('board-colheads');
    expect(heads.className).toContain('vkgb-sticky-top');
    for (const c of BOARD.columns) expect(heads.textContent).toContain(c.title);
    expect(within(deskEl).getByRole('alert').textContent).toContain('цикл: A ⇄ B');
  });

  it('lane header: sticky label, epic name opens the epic graph, progress, collapse toggle', () => {
    const { desk, onOpenEpic, onToggleLane } = setup();
    const label = desk.getByTestId('board-lane-label-M03');
    expect(label.className).toContain('vkgb-sticky-left');
    expect(label.textContent).toContain('8 из 20');
    fireEvent.click(within(label).getByRole('button', { name: 'M03' }));
    expect(onOpenEpic).toHaveBeenCalledWith('M03');
    fireEvent.click(within(label).getByRole('button', { name: 'Свернуть M03' }));
    expect(onToggleLane).toHaveBeenCalledWith('M03');
  });

  it('an epic that waits on whole epics is marked in its header', () => {
    const { desk } = setup();
    expect(desk.getByTestId('board-lane-label-M13').textContent).toContain('ждёт M05–M12');
  });

  it('a collapsed lane shows the one-line summary and expands on click', () => {
    const { desk, card, onToggleLane } = setup();
    const row = desk.getByTestId('board-summary-M05');
    expect(row.textContent).toContain('M05 · 9 задач · план не одобрен');
    expect(card('c1')).toBeNull();
    fireEvent.click(row);
    expect(onToggleLane).toHaveBeenCalledWith('M05');
  });

  it('places a card per visible node and a line per edge', () => {
    const { card, edge } = setup();
    for (const id of ['q1', 'a1', 'a2', 'b1', 'b2', 'd1']) expect(card(id)).toBeTruthy();
    for (const e of BOARD.edges) expect(edge(e.from, e.to)).toBeTruthy();
  });

  it('«Ответить» answers the question; clicking a card selects it', () => {
    const { card, onAnswer, onSelect } = setup();
    fireEvent.click(within(card('q1')!).getByRole('button', { name: 'Ответить' }));
    expect(onAnswer).toHaveBeenCalledWith('q1');
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(card('b2')!);
    expect(onSelect).toHaveBeenCalledWith('b2');
  });

  it('V5 hover lights the chain toward and away across lanes and dims the rest', () => {
    const { card, edge } = setup();
    fireEvent.mouseEnter(card('a2')!);
    expect(edge('a1', 'a2')?.getAttribute('data-lit')).toBe('toward');
    expect(edge('a2', 'b1')?.getAttribute('data-lit')).toBe('away');
    expect(edge('b2', 'b1')?.getAttribute('data-lit')).toBe('faint');
    expect(card('b2')!.getAttribute('data-dim')).toBe('true');
    expect(card('b1')!.getAttribute('data-dim')).toBe('false');
  });

  it('V1 hover on «Ответить» shows the what-if banner and the wave', () => {
    const { card, edge, desk } = setup();
    const btn = within(card('q1')!).getByRole('button', { name: 'Ответить' });
    fireEvent.mouseEnter(card('q1')!);
    fireEvent.mouseEnter(btn);
    expect(desk.getByRole('status').textContent).toContain('Если ответишь');
    expect(edge('q1', 'b2')?.getAttribute('data-lit')).toBe('wave');
  });

  it('click select (V5-Click) holds the chain lit', () => {
    const { card, edge } = setup(BOARD, 'a2');
    expect(card('a2')!.getAttribute('aria-current')).toBe('true');
    expect(edge('a1', 'a2')?.getAttribute('data-lit')).toBe('held');
    expect(edge('b2', 'b1')?.getAttribute('data-lit')).toBe('faint');
  });

  it('measures its width with a ResizeObserver and widens the columns', () => {
    let fire: ((w: number) => void) | null = null;
    class RO {
      constructor(cb: ResizeObserverCallback) {
        fire = (w) => cb([{ contentRect: { width: w } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', RO);
    const { desk } = setup();
    const w0 = parseFloat(desk.getByTestId('board-col-1').style.width);
    expect(w0).toBe(190);
    act(() => fire!(1600));
    const w1 = parseFloat(desk.getByTestId('board-col-1').style.width);
    expect(w1).toBeGreaterThan(190);
    expect(w1).toBeLessThanOrEqual(380);
  });

  it('«вписать по ширине» scales the canvas to the viewport width (floored at 0.6), and back', () => {
    const { desk } = setup();
    const scroll = desk.getByTestId('board-scroll');
    Object.defineProperty(scroll, 'clientWidth', { configurable: true, value: 400 });
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 300 });
    fireEvent.click(desk.getByRole('button', { name: 'вписать по ширине' }));
    const canvas = desk.getByTestId('board-canvas');
    expect(canvas.getAttribute('data-fit')).toBe('on');
    expect(canvas.style.transform).toBe('scale(0.600)');
    fireEvent.click(desk.getByRole('button', { name: 'обычный масштаб' }));
    expect(canvas.getAttribute('data-fit')).toBe('off');
  });

  it('the banner slot is always rendered, empty without hover, so hover never moves the graph', () => {
    const { desk, card } = setup();
    const slot = desk.getByTestId('board-banner');
    expect(slot.textContent).toBe('');
    expect(desk.getByText(BOARD.headline)).toBeTruthy();
    fireEvent.mouseEnter(card('a2')!);
    expect(desk.getByTestId('board-banner')).toBe(slot);
    expect(slot.textContent).not.toBe('');
    expect(desk.getByText(BOARD.headline)).toBeTruthy();
  });

  it('clears hover about 80 ms after the pointer leaves, not at once', () => {
    vi.useFakeTimers();
    try {
      const { desk, card } = setup();
      fireEvent.mouseEnter(card('a2')!);
      fireEvent.mouseLeave(card('a2')!);
      expect(desk.getByTestId('board-banner').textContent).not.toBe('');
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(desk.getByTestId('board-banner').textContent).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows «↓ ещё N ниже» / «→ ещё N правее» for the lit chain off screen and scrolls there', () => {
    const { desk } = setup(BOARD, 'q1');
    const scroll = desk.getByTestId('board-scroll');
    Object.defineProperty(scroll, 'clientWidth', { configurable: true, value: 300 });
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 160 });
    fireEvent.scroll(scroll);
    const down = desk.getByRole('button', { name: /↓ ещё \d+ ниже/ });
    const right = desk.getByRole('button', { name: /→ ещё \d+ правее/ });
    fireEvent.click(right);
    expect(scroll.scrollLeft).toBeGreaterThan(0);
    fireEvent.click(down);
    expect(scroll.scrollTop).toBeGreaterThan(0);
  });

  it('no off-screen hints without a lit chain', () => {
    const { desk } = setup();
    const scroll = desk.getByTestId('board-scroll');
    Object.defineProperty(scroll, 'clientWidth', { configurable: true, value: 300 });
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 160 });
    fireEvent.scroll(scroll);
    expect(desk.queryByRole('button', { name: /ещё \d+/ })).toBeNull();
  });
});

describe('BoardGraphView phone accordion', () => {
  it('lanes are accordions with a waves list and no lines', () => {
    const { onSelect } = setup();
    const phone = within(screen.getByTestId('board-phone'));
    expect(screen.getByTestId('board-phone').querySelector('.vkg-edge, [data-edge]')).toBeNull();
    // the shared «От тебя» questions come first
    expect(phone.getByText('вопрос · L1')).toBeTruthy();
    // approved lanes start open, collapsed drafts start closed
    const m03 = phone.getByRole('button', { name: /Эпик M03/ });
    expect(m03.getAttribute('aria-expanded')).toBe('true');
    const m05 = phone.getByRole('button', { name: /Эпик M05/ });
    expect(m05.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('board-phone').querySelector('[data-node-id="c1"]')).toBeNull();
    fireEvent.click(m05);
    expect(m05.getAttribute('aria-expanded')).toBe('true');
    const c1 = screen.getByTestId('board-phone').querySelector('[data-node-id="c1"]') as HTMLElement;
    expect(c1).toBeTruthy();
    // wave title shown inside the lane
    expect(within(screen.getByTestId('board-phone-lane-M03')).getByText('Следом')).toBeTruthy();
    fireEvent.click(c1);
    expect(onSelect).toHaveBeenCalledWith('c1');
  });
});

describe('column header band', () => {
  // Live 16.11 (2000 px): the «Сейчас» verdict wraps to two lines and spilled
  // out of a 72 px band over the first lane. The band holds the 8 px inset,
  // the title bar (~38 px), the 6 px gap and a two-line verdict (2×18 + 8).
  it('is tall enough for the title bar and a two-line verdict', () => {
    expect(COLHEAD_H).toBeGreaterThanOrEqual(8 + 38 + 6 + 2 * 18 + 8);
  });
});
