import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { setLocale } from '../../i18n';
import { assertAtMostOneMark } from '../../test/assertions/oneMarkRule';
import { m04Idle } from '../../test/fixtures/m04Idle';
import { renderBoard } from '../../test/renderBoard';

// B5: one board drawn as a route — five stops with counts, tracks that hang
// under them, Waiting folded by stage, Merged showing five, and a notice that
// says why nobody works when the middle is empty.

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  setLocale('en');
});

function bead(id: string, extra: Partial<SupervisorBead> = {}): SupervisorBead {
  return {
    id,
    title: `bead ${id}`,
    status: 'open',
    issue_type: 'task',
    created_at: '2026-11-15T08:00:00Z',
    ...extra,
  };
}

function idleBoard() {
  const input = m04Idle();
  return renderBoard(input.tasks, {
    routeBeads: input.routeItems,
    serviceItems: input.serviceItems,
  });
}

const stageRegions = () =>
  screen
    .getAllByRole('region')
    .filter((r) => r.hasAttribute('data-stage'))
    .map((r) => r.getAttribute('aria-label'));

describe('BeadBoard as a route', () => {
  it('one board, five stages in route order', () => {
    renderBoard([bead('dw-a')]);
    expect(screen.getAllByRole('region', { name: 'Board' })).toHaveLength(1);
    expect(stageRegions()).toEqual(['Waiting', 'Working', 'Review', 'PR', 'Merged']);
  });

  it('stops name and count each stage', () => {
    renderBoard([bead('dw-a'), bead('dw-b'), bead('dw-c')]);
    const stop = screen.getByRole('link', { name: 'Waiting: 3' });
    expect(stop.getAttribute('href')).toBe('#stage-waiting');
    expect(within(stop).getByText('3').className).toMatch(/font-display/);
    const merged = screen.getByRole('link', { name: 'Merged: 0' });
    expect(within(merged).getByText('recent')).toBeTruthy();
  });

  it('a stop with cards is filled, an empty one is a ring', () => {
    renderBoard([bead('dw-a')]);
    expect(
      screen
        .getByRole('link', { name: 'Waiting: 1' })
        .querySelector('[data-filled]')
        ?.getAttribute('data-filled'),
    ).toBe('true');
    expect(
      screen
        .getByRole('link', { name: 'Review: 0' })
        .querySelector('[data-filled]')
        ?.getAttribute('data-filled'),
    ).toBe('false');
  });

  it('the idle notice names the blocker and links it', () => {
    idleBoard();
    expect(screen.getByText('Nobody is working right now.')).toBeTruthy();
    expect(screen.getByText('2 tasks of stage M04 wait for card dw-4xn4b')).toBeTruthy();
    const blocker = screen.getByRole('link', {
      name: 'Пакет этапа M04: исполнимый план по мастер-плану §4/§7',
    });
    expect(blocker.getAttribute('href')).toBe('/beads?bead=dw-4xn4b');
    expect(screen.getByRole('link', { name: 'Open the run' }).getAttribute('href')).toBe(
      '/runs/gcg-153601?scope_kind=rig&scope_ref=devwork',
    );
    for (const name of ['Working', 'Review', 'PR']) {
      expect(within(screen.getByRole('region', { name })).getByText('None')).toBeTruthy();
    }
  });

  it('unknown says it cannot tell', () => {
    const input = m04Idle();
    renderBoard(input.tasks, {
      routeBeads: input.routeItems,
      serviceItems: input.serviceItems,
      routesComplete: false,
    });
    expect(
      screen.getByText('The board read only part of the tasks, so it cannot tell who is working.'),
    ).toBeTruthy();
    expect(screen.queryByText('Nobody is working right now.')).toBeNull();
  });

  it('idle without a cause says so', () => {
    const root = bead('gcg-r', {
      status: 'in_progress',
      metadata: { 'gc.kind': 'workflow', 'gc.var.issue': 'dw-gone' },
    });
    renderBoard([bead('dw-a', { is_blocked: true })], { routeBeads: [root] });
    expect(screen.getByText('Nobody is working right now.')).toBeTruthy();
    expect(screen.getByText('No reason found in the board data.')).toBeTruthy();
  });

  it('a busy board has no notice', () => {
    renderBoard([bead('dw-w', { status: 'in_progress' })]);
    expect(screen.queryByText('Nobody is working right now.')).toBeNull();
  });

  it('a big Waiting folds into stage groups', () => {
    const items = [
      ...Array.from({ length: 7 }, (_, i) =>
        bead(`dw-3${i}`, { title: `M03 card ${i}`, labels: ['milestone:M03'] }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        bead(`dw-4${i}`, { title: `M04 card ${i}`, labels: ['milestone:M04'] }),
      ),
    ];
    const first = renderBoard(items);
    const m03 = screen.getByRole('button', { name: /^M03/ });
    const m04 = screen.getByRole('button', { name: /^M04/ });
    expect(m03.getAttribute('aria-expanded')).toBe('false');
    expect(m04.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('M04 card 0')).toBeNull();
    fireEvent.click(m04);
    expect(first.onToggleGroup).toHaveBeenCalledWith('milestone:M04');
    cleanup();
    renderBoard(items, { openGroups: new Set(['milestone:M04']) });
    for (let i = 0; i < 6; i++) expect(screen.getByText(`M04 card ${i}`)).toBeTruthy();
    expect(screen.queryByText('M03 card 0')).toBeNull();
  });

  it('a small Waiting shows groups open', () => {
    renderBoard([
      bead('dw-a', { labels: ['milestone:M04'] }),
      bead('dw-b', { labels: ['milestone:M04'] }),
      bead('dw-c'),
    ]);
    expect(
      screen.queryAllByRole('button').filter((b) => b.hasAttribute('aria-expanded')),
    ).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 4, name: /^M04/ })).toBeTruthy();
    expect(screen.getByText('bead dw-a')).toBeTruthy();
  });

  it('Merged shows five, then Show N more', () => {
    const merged = Array.from({ length: 8 }, (_, i) =>
      bead(`dw-m${i}`, {
        title: `merged ${i}`,
        status: 'closed',
        updated_at: `2026-11-15T0${i}:00:00Z`,
      }),
    );
    const { onToggleHistory } = renderBoard(merged);
    const region = screen.getByRole('region', { name: 'Merged' });
    expect(within(region).getAllByText(/^merged \d$/)).toHaveLength(5);
    expect(within(region).getByRole('button', { name: 'Show 3 more' })).toBeTruthy();
    const history = within(region).getByRole('button', { name: 'Show all history' });
    expect(history.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(history);
    expect(onToggleHistory).toHaveBeenCalled();
  });

  it('columns fold, never scroll inside', () => {
    const { container } = idleBoard();
    expect(container.querySelector('.max-h-\\[28rem\\]')).toBeNull();
    expect(container.querySelector('.overflow-y-auto')).toBeNull();
  });

  it('long blocker title wraps', () => {
    const input = m04Idle();
    const long = `${'Очень длинное название '.repeat(8)}https://example.com/${'a'.repeat(100)}`;
    input.tasks.find((b) => b.id === 'dw-4xn4b')!.title = long;
    renderBoard(input.tasks, { routeBeads: input.routeItems, serviceItems: input.serviceItems });
    expect(screen.getByRole('link', { name: long }).className).toContain(
      '[overflow-wrap:anywhere]',
    );
  });

  it('One Mark Rule with attention cards', () => {
    const { container } = renderBoard([
      bead('dw-1', { status: 'in_progress', metadata: { 'devwork.tdd_refusal': 'no RED' } }),
      bead('dw-2', { status: 'in_progress', metadata: { 'devwork.tdd_refusal': 'no RED' } }),
    ]);
    assertAtMostOneMark(container);
  });

  it('Russian', () => {
    setLocale('ru');
    idleBoard();
    for (const name of ['Ждёт', 'В работе', 'Ревью', 'PR', 'Влито']) {
      expect(screen.getByRole('region', { name })).toBeTruthy();
    }
    expect(screen.getByText('Сейчас никто не работает.')).toBeTruthy();
    expect(screen.getByText('2 задачи этапа M04 ждут карточку dw-4xn4b')).toBeTruthy();
  });
});
