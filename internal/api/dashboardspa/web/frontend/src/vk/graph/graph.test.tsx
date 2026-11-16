import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphView, layoutGraph } from './GraphView';
import { M04 } from './graphFixture';
import { whatIfBanner } from './model';

// view lane (16.11 «Граф»): Graph-Epic layout, V1 / V5 hover, V5-Click select, Graph-Phone.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(selectedId: string | null = null) {
  const onSelect = vi.fn();
  const onAnswer = vi.fn();
  const utils = render(
    <GraphView model={M04} selectedId={selectedId} onSelect={onSelect} onAnswer={onAnswer} />,
  );
  const desk = within(screen.getByTestId('graph-desktop'));
  const card = (id: string) => screen.getByTestId('graph-desktop').querySelector(`[data-node-id="${id}"]`) as HTMLElement;
  const edge = (from: string, to: string) =>
    screen.getByTestId('graph-desktop').querySelector(`[data-edge="${from}>${to}"]`) as SVGPathElement;
  return { ...utils, onSelect, onAnswer, desk, card, edge };
}

describe('GraphView layout (Graph-Epic)', () => {
  it('renders every column with its title, count and verdict, and the headline', () => {
    const { desk } = setup();
    for (const c of M04.columns) {
      const head = desk.getByTestId(`graph-col-${c.title}`);
      expect(head.textContent).toContain(c.title);
      expect(head.textContent).toContain(String(c.count));
      expect(head.textContent).toContain(c.verdict);
    }
    expect(desk.getByText(M04.headline)).toBeTruthy();
    expect(desk.getByText(M04.subline)).toBeTruthy();
  });

  it('places one card per node and one line per edge', () => {
    const { card, edge } = setup();
    for (const n of M04.nodes) expect(card(n.id)).toBeTruthy();
    for (const e of M04.edges) expect(edge(e.from, e.to)).toBeTruthy();
  });

  it('question cards carry an «Ответить» button that answers, not selects', () => {
    const { card, onAnswer, onSelect } = setup();
    fireEvent.click(within(card('ql1')).getByRole('button', { name: 'Ответить' }));
    expect(onAnswer).toHaveBeenCalledWith('ql1');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('an outside card is marked «снаружи»', () => {
    const { card } = setup();
    expect(card('t6').getAttribute('data-outside')).toBe('true');
  });
});

describe('click select (V5-Click)', () => {
  it('clicking a card calls onSelect with its id', () => {
    const { card, onSelect } = setup();
    fireEvent.click(card('s3'));
    expect(onSelect).toHaveBeenCalledWith('s3');
  });

  it('exactly one card is selected and it carries aria-current', () => {
    const { card } = setup('s3');
    expect(card('s3').getAttribute('aria-current')).toBe('true');
    const sel = screen.getByTestId('graph-desktop').querySelectorAll('[aria-current="true"]');
    expect(sel).toHaveLength(1);
  });

  it('dims cards off the selected chain and keeps the chain lit', () => {
    const { card, edge } = setup('s3');
    for (const id of ['m3', 't6', 'qv4', 'ql1', 's1', 'a1', 'gw']) expect(card(id).getAttribute('data-dim')).toBe('false');
    for (const id of ['qv3', 's9', 'qv6']) expect(card(id).getAttribute('data-dim')).toBe('true');
    expect(edge('m3', 's3').getAttribute('data-lit')).toBe('held');
    expect(edge('a1', 'gw').getAttribute('data-lit')).toBe('held');
    expect(edge('qv3', 's9').getAttribute('data-lit')).toBe('faint');
  });

  it('with nothing selected nothing is dimmed', () => {
    const { card } = setup();
    expect(card('qv3').getAttribute('data-dim')).toBe('false');
  });

  it('Enter on a focused card selects it', () => {
    const { card, onSelect } = setup();
    fireEvent.keyDown(card('a1'), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('a1');
  });
});

describe('hover (V5-Hover, V1-WhatIf)', () => {
  it('hovering a middle card shows its whatIfBanner and sweeps lines toward and away', () => {
    const { card, edge, desk } = setup();
    fireEvent.mouseEnter(card('s3'));
    expect(desk.getByRole('status').querySelector('p')?.textContent).toBe(whatIfBanner(M04, 's3'));
    expect(edge('m3', 's3').getAttribute('data-lit')).toBe('toward');
    expect(edge('ql1', 't6').getAttribute('data-lit')).toBe('toward');
    expect(edge('s3', 'a1').getAttribute('data-lit')).toBe('away');
    expect(edge('a1', 'gw').getAttribute('data-lit')).toBe('away');
    expect(edge('qv3', 's9').getAttribute('data-lit')).toBe('faint');
    expect(card('qv3').getAttribute('data-dim')).toBe('true');
  });

  it('clears hover about 80 ms after the pointer leaves', () => {
    vi.useFakeTimers();
    try {
      const { card, desk } = setup();
      fireEvent.mouseEnter(card('s3'));
      fireEvent.mouseLeave(card('s3'));
      expect(desk.getByTestId('graph-banner').textContent).not.toBe('');
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(desk.getByTestId('graph-banner').textContent).toBe('');
      expect(desk.getByText(M04.headline)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hovering «Ответить» runs the what-if wave along the question chain', () => {
    const { card, edge, desk } = setup();
    fireEvent.mouseEnter(within(card('ql1')).getByRole('button', { name: 'Ответить' }));
    expect(desk.getByRole('status').querySelector('p')?.textContent).toBe(whatIfBanner(M04, 'ql1'));
    expect(edge('ql1', 't6').getAttribute('data-lit')).toBe('wave');
    expect(edge('s3', 's1').getAttribute('data-lit')).toBe('wave');
    expect(edge('qv4', 'm3').getAttribute('data-lit')).toBe('faint');
  });

  it('hover takes over from the selection and gives it back on leave', () => {
    vi.useFakeTimers();
    const { card, edge } = setup('s9');
    fireEvent.mouseEnter(card('s3'));
    expect(edge('m3', 's3').getAttribute('data-lit')).toBe('toward');
    fireEvent.mouseLeave(card('s3'));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    vi.useRealTimers();
    expect(edge('m3', 's3').getAttribute('data-lit')).toBe('faint');
    expect(edge('qv3', 's9').getAttribute('data-lit')).toBe('held');
  });
});

describe('reduced motion', () => {
  it('motion is off when the viewer prefers reduced motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('reduce'),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const { card } = setup();
    fireEvent.mouseEnter(card('s3'));
    expect(screen.getByTestId('graph-desktop').getAttribute('data-motion')).toBe('off');
  });

  it('motion is on by default', () => {
    setup();
    expect(screen.getByTestId('graph-desktop').getAttribute('data-motion')).toBe('on');
  });
});

describe('phone (Graph-Phone)', () => {
  it('lists the waves top to bottom with their cards and no lines', () => {
    const onSelect = vi.fn();
    const onAnswer = vi.fn();
    render(<GraphView model={M04} selectedId={null} onSelect={onSelect} onAnswer={onAnswer} />);
    const phone = screen.getByTestId('graph-phone');
    const waves = phone.querySelectorAll('[data-wave-title]');
    expect([...waves].map((w) => w.getAttribute('data-wave-title'))).toEqual(M04.columns.map((c) => c.title));
    expect(phone.querySelector('[data-edge]')).toBeNull();
    fireEvent.click(within(phone).getAllByRole('button', { name: 'Ответить' })[0] as HTMLElement);
    expect(onAnswer).toHaveBeenCalledWith('qv3');
    fireEvent.click(phone.querySelector('[data-node-id="s3"]') as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith('s3');
  });
});

describe('GraphView column verdicts (integration 16.11, eyes on live M04)', () => {
  afterEach(cleanup);

  it('a long verdict is clamped to two lines (it ran into the first card) and keeps its full text as a title', () => {
    const long = 'в работе 1 из 3 · 1 ждёт твоего ответа · 1 никто не взял · и ещё очень длинный хвост';
    const model = { ...M04, columns: M04.columns.map((c, i) => (i === 1 ? { ...c, verdict: long } : c)) };
    render(<GraphView model={model} selectedId={null} onSelect={vi.fn()} onAnswer={vi.fn()} />);
    const col = screen.getByTestId(`graph-col-${M04.columns[1]?.title ?? ''}`);
    const text = within(col).getByText(long);
    expect(text.classList.contains('vkg-verdict-text')).toBe(true);
    expect(text.getAttribute('title')).toBe(long);
  });
});

describe('GraphView phone question rows (integration 16.11, eyes at 390 px)', () => {
  afterEach(cleanup);

  it('stacks the «вопрос · …» label above the title instead of squeezing both into one line', () => {
    render(<GraphView model={M04} selectedId={null} onSelect={vi.fn()} onAnswer={vi.fn()} />);
    const phone = screen.getByTestId('graph-phone');
    const row = phone.querySelector('.vkg-qrow') as HTMLElement;
    const label = row.querySelector('.vkg-qrow-label') as HTMLElement;
    const title = row.querySelector('.vkg-qrow-title') as HTMLElement;
    expect(label).not.toBeNull();
    expect(title).not.toBeNull();
    expect(label.parentElement).toBe(title.parentElement);
    expect(label.parentElement?.classList.contains('vkg-qrow-text')).toBe(true);
  });
});

describe('fluid layout (integration 16.11, eyes at 2000 px: graph used only the left 60%)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const cols = Math.max(M04.columns.length, M04.nodes.reduce((m, n) => Math.max(m, n.column), 0) + 1);

  it('without a measured width the columns keep the 190 px floor', () => {
    const l = layoutGraph(M04);
    expect(l.colW).toBe(190);
  });

  it('spreads columns over the available width: (width − gaps) / columns', () => {
    const avail = 1500;
    const l = layoutGraph(M04, avail);
    const want = Math.min(380, Math.max(190, (avail - (cols - 1) * 26) / cols));
    expect(l.colW).toBeCloseTo(want, 5);
    expect(l.width).toBeCloseTo(Math.min(avail, cols * 380 + (cols - 1) * 26), 5);
    for (const n of M04.nodes) expect(l.box.get(n.id)?.w).toBeCloseTo(want, 5);
  });

  it('clamps the column width between 190 and 380 px', () => {
    expect(layoutGraph(M04, 400).colW).toBe(190);
    expect(layoutGraph(M04, 10000).colW).toBe(380);
  });

  it('routes the lines from the same computed card positions', () => {
    const l = layoutGraph(M04, 1800);
    const e = M04.edges[0];
    if (e === undefined) throw new Error('fixture has no edges');
    const a = l.box.get(e.from);
    if (a === undefined) throw new Error('missing box');
    expect(l.paths.get(`${e.from}>${e.to}`)).toMatch(new RegExp(`^M ${(a.x + a.w).toFixed(1)} `));
  });

  it('measures the container with a ResizeObserver and widens cards and column heads', () => {
    let fire: ((w: number) => void) | null = null;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        cb: ResizeObserverCallback;
        constructor(cb: ResizeObserverCallback) {
          this.cb = cb;
        }
        observe() {
          fire = (w: number) => this.cb([{ contentRect: { width: w } } as ResizeObserverEntry], this as unknown as ResizeObserver);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    const { card } = setup();
    expect(fire).not.toBeNull();
    act(() => fire?.(1800));
    const want = Math.min(380, Math.max(190, (1800 - (cols - 1) * 26) / cols));
    const n = M04.nodes[0];
    if (n === undefined) throw new Error('no nodes');
    expect(parseFloat(card(n.id).style.width)).toBeCloseTo(want, 3);
    const head = screen.getByTestId(`graph-col-${M04.columns[0]?.title ?? ''}`);
    expect(parseFloat(head.style.width)).toBeCloseTo(want, 3);
  });

  it('a card title carries its full text as a tooltip (one line, ellipsis)', () => {
    const { card } = setup();
    const n = M04.nodes.find((x) => x.kind === 'task');
    if (n === undefined) throw new Error('no task');
    const title = card(n.id).querySelector('.vkg-title') as HTMLElement;
    expect(title.getAttribute('title')).toBe(n.title);
  });

  it('the banner slot is always rendered (empty without hover) and the headline stays put', () => {
    const { card } = setup();
    const slot = screen.getByTestId('graph-banner');
    expect(slot.textContent).toBe('');
    expect(screen.getByTestId('graph-head').querySelector('.vkg-concl')).not.toBeNull();
    const n = M04.nodes.find((x) => x.kind === 'task');
    if (n === undefined) throw new Error('no task');
    fireEvent.mouseEnter(card(n.id));
    expect(screen.getByTestId('graph-banner')).toBe(slot);
    expect(slot.textContent).not.toBe('');
    expect(screen.getByTestId('graph-head').querySelector('.vkg-concl')).not.toBeNull();
  });
});
