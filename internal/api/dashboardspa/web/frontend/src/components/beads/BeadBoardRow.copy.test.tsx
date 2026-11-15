import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../../i18n';
import { ALL_PROJECTS, buildBoardModel, type BoardCard } from '../../lib/boardModel';
import { STAGES } from '../../lib/stageBoard';
import { formatWhen } from '../../lib/whenText';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { boardData } from '../../test/renderBoard';
import { BeadBoardRow } from './BeadBoardRow';

// B6: a card speaks plain words. Title first; one card line with the wait
// word, what it holds, the city tag, P0/P1 and the faint id last.

const NOW = Date.parse('2026-11-15T10:40:00Z');
const DECISION_TITLE = 'M03 #2 / L1: перенос ящика на основной аккаунт и 0424 — когда окно?';

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

const blocks = (issue: string, target: string) => ({
  issue_id: issue,
  depends_on_id: target,
  type: 'blocks',
});

function cardOf(
  id: string,
  beads: SupervisorBead[],
  extra: { routeBeads?: SupervisorBead[]; serviceItems?: SupervisorBead[] } = {},
): BoardCard {
  const model = buildBoardModel(boardData(beads, extra), [], {
    project: ALL_PROJECTS,
    search: '',
    showTests: false,
  });
  for (const stage of STAGES) {
    const card = model.columns[stage.id].find((c) => c.node.bead.id === id);
    if (card) return card;
  }
  throw new Error(`no card ${id}`);
}

function renderCard(card: BoardCard, note: string | null = null) {
  return render(
    <MemoryRouter>
      <ul>
        <BeadBoardRow card={card} selected={false} note={note} nowMs={NOW} onSelect={vi.fn()} />
      </ul>
    </MemoryRouter>,
  );
}

const cardLine = (container: HTMLElement) =>
  container.querySelector('[data-card-line]') as HTMLElement;

describe('BeadBoardRow copy', () => {
  it('title first, id last and quiet', () => {
    const { container } = renderCard(cardOf('dw-a', [bead('dw-a')]));
    const line = cardLine(container);
    const last = line.lastElementChild as HTMLElement;
    expect(last.textContent).toBe('dw-a');
    expect(last.className).toMatch(/font-mono/);
    expect(last.className).toMatch(/text-fg-faint/);
    const button = screen.getByTitle('Select dw-a');
    expect(button.textContent).toBe('bead dw-a');
  });

  it('ready to take', () => {
    renderCard(cardOf('dw-a', [bead('dw-a')]));
    expect(screen.getByText('ready to take')).toBeTruthy();
    cleanup();
    setLocale('ru');
    renderCard(cardOf('dw-a', [bead('dw-a')]));
    expect(screen.getByText('можно брать')).toBeTruthy();
  });

  it('queued links its run', () => {
    const root = bead('gcg-q', {
      is_blocked: true,
      metadata: { 'gc.kind': 'workflow', 'gc.var.issue': 'dw-q' },
    });
    const card = cardOf('dw-q', [bead('dw-q', { is_blocked: true })], { routeBeads: [root] });
    renderCard(card);
    const link = screen.getByTitle('Open run gcg-q');
    expect(link.textContent).toBe('Queued');
    cleanup();
    setLocale('ru');
    renderCard(card);
    expect(screen.getByText('в очереди')).toBeTruthy();
  });

  it('waits for tasks, Russian plurals', () => {
    const waiter = (n: number) => {
      const blockers = Array.from({ length: n }, (_, i) => bead(`dw-b${i}`));
      const task = bead('dw-t', {
        is_blocked: true,
        dependencies: blockers.map((b) => blocks('dw-t', b.id)),
      });
      return cardOf('dw-t', [task, ...blockers]);
    };
    renderCard(waiter(3));
    expect(screen.getByText('waits for 3 tasks')).toBeTruthy();
    cleanup();
    setLocale('ru');
    for (const [n, text] of [
      [1, 'ждёт 1 задачу'],
      [3, 'ждёт 3 задачи'],
      [5, 'ждёт 5 задач'],
    ] as const) {
      renderCard(waiter(n));
      expect(screen.getByText(text)).toBeTruthy();
      cleanup();
    }
  });

  it('holds, Russian plurals', () => {
    setLocale('ru');
    for (const [n, text] of [
      [1, 'держит 1 задачу'],
      [2, 'держит 2 задачи'],
      [13, 'держит 13 задач'],
    ] as const) {
      const held = Array.from({ length: n }, (_, i) =>
        bead(`dw-h${i}`, { is_blocked: true, dependencies: [blocks(`dw-h${i}`, 'dw-4xn4b')] }),
      );
      renderCard(cardOf('dw-4xn4b', [bead('dw-4xn4b'), ...held]));
      expect(screen.getByText(text)).toBeTruthy();
      cleanup();
    }
  });

  it('waits for a decision', () => {
    setLocale('ru');
    const gate = bead('dw-ssmbcp', { issue_type: 'gate', title: DECISION_TITLE });
    const task = bead('dw-e', { is_blocked: true, dependencies: [blocks('dw-e', 'dw-ssmbcp')] });
    renderCard(cardOf('dw-e', [task], { serviceItems: [gate] }));
    expect(screen.getByText(`ждёт решения: «${DECISION_TITLE}»`)).toBeTruthy();
  });

  it('no middle dot', () => {
    const task = bead('dw-a', { priority: 0, needs: ['dw-b'], is_blocked: true });
    const { container } = renderCard(cardOf('dw-a', [task, bead('dw-b')]));
    expect(container.textContent).not.toContain('·');
  });

  it('P2 hidden, P0 shown', () => {
    renderCard(cardOf('dw-a', [bead('dw-a', { priority: 2 })]));
    expect(screen.queryByText('P2')).toBeNull();
    cleanup();
    renderCard(cardOf('dw-a', [bead('dw-a', { priority: 0 })]));
    expect(screen.getByText('P0')).toBeTruthy();
  });

  it('a routed card hides the liveness note', () => {
    const root = bead('gcg-r', {
      status: 'in_progress',
      metadata: { 'gc.kind': 'workflow', 'gc.var.issue': 'dw-r' },
    });
    const step = bead('gcg-s', {
      status: 'in_progress',
      metadata: { 'gc.root_bead_id': 'gcg-r', 'dashboard.stage': 'working' },
    });
    const routed = cardOf('dw-r', [bead('dw-r', { status: 'in_progress' })], {
      routeBeads: [root, step],
    });
    renderCard(routed, 'stalled 1h — no assignee');
    expect(screen.queryByText('stalled 1h — no assignee')).toBeNull();
    cleanup();
    const plain = cardOf('dw-p', [bead('dw-p', { status: 'in_progress' })]);
    renderCard(plain, 'stalled 1h — no assignee');
    expect(screen.getByText('stalled 1h — no assignee')).toBeTruthy();
  });

  it('the step label prefers dashboard.label', () => {
    const root = bead('gcg-r', {
      status: 'in_progress',
      metadata: { 'gc.kind': 'workflow', 'gc.var.issue': 'dw-r' },
    });
    const step = bead('gcg-s', {
      title: 'implement',
      status: 'in_progress',
      metadata: {
        'gc.root_bead_id': 'gcg-r',
        'dashboard.stage': 'working',
        'dashboard.label': 'пишет код',
      },
    });
    renderCard(
      cardOf('dw-r', [bead('dw-r', { status: 'in_progress' })], { routeBeads: [root, step] }),
    );
    expect(screen.getByTitle('Open step gcg-s in its run').textContent).toBe('пишет код');
  });

  it('merged without a close reason links its last step', () => {
    const root = bead('gcg-r', {
      status: 'closed',
      metadata: { 'gc.kind': 'workflow', 'gc.var.issue': 'dw-m' },
    });
    const step = bead('gcg-s', {
      title: 'approve',
      status: 'closed',
      metadata: { 'gc.root_bead_id': 'gcg-r', 'dashboard.stage': 'merged' },
    });
    renderCard(cardOf('dw-m', [bead('dw-m', { status: 'closed' })], { routeBeads: [root, step] }));
    expect(screen.getByTitle('Open step gcg-s in its run').textContent).toBe('approve');
  });

  it('merged says when', () => {
    setLocale('ru');
    const updated = '2026-11-15T09:10:00Z';
    const { container } = renderCard(
      cardOf('dw-m', [bead('dw-m', { status: 'closed', updated_at: updated })]),
    );
    expect(within(cardLine(container)).getByText(`влито ${formatWhen(updated, NOW)}`)).toBeTruthy();
  });
});
