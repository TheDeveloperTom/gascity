import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { TaskStages } from '../../hooks/useTaskStages';
import { setLocale } from '../../i18n';
import { needsFromBoard } from '../../lib/needsFromMe';
import {
  NOW_MS,
  OWNER_ITEMS,
  QUESTION_ID,
  HELD_STALL_ID,
  STALLED_ID,
  UNLINKED_ID,
  needsBoard,
  needsBoardWithHeldStall,
} from './needsFixture';
import { NeedsShelves } from './Shelf';

const openExternal = vi.hoisted(() => vi.fn());
vi.mock('../../lib/openExternal', () => ({ openExternal }));

const STAGES: TaskStages = {
  state: 'ready',
  inFlight: [
    { id: 'dw-580', title: 'Сделать invalidation', stage: 'working', stepLabel: null, href: '/b/1' },
    { id: 'dw-581', title: 'Судья читает', stage: 'review', stepLabel: null, href: '/b/2' },
  ],
  queued: 0,
  outsideWindow: 0,
};

function show() {
  const model = needsFromBoard(needsBoard(), [], [], NOW_MS, false, OWNER_ITEMS);
  const view = render(
    <MemoryRouter>
      <NeedsShelves model={model} stages={STAGES} />
    </MemoryRouter>,
  );
  return { model, ...view };
}

function itemOf(id: string): HTMLElement {
  const item = document.querySelector<HTMLElement>(`[data-need="${id}"]`);
  if (item === null) throw new Error(`no need ${id}`);
  return item;
}

describe('«Нужно от меня» shelves', () => {
  beforeEach(() => setLocale('ru'));
  afterEach(() => {
    cleanup();
    setLocale('en');
  });

  // H1 16.11: the live page shifted 0.3–0.6 CLS on load. «Работает» and «Тихо»
  // rendered under a «Нужно от меня» that was still reading the board; the
  // stuck list then arrived and pushed both down. Until the board is read,
  // only the first shelf (with its «Читаю доску…») is on the page.
  it('while the board is still read, shows only the first shelf so nothing below it jumps', () => {
    const model = needsFromBoard(undefined, [], [], NOW_MS, true, []);
    expect(model.state).toBe('loading');
    render(
      <MemoryRouter>
        <NeedsShelves model={model} stages={STAGES} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Читаю доску…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Работает/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Тихо/ })).toBeNull();
  });

  // H1 16.11 (phone, peer data): the Mayors' questions arrive with the peer
  // boards after our board; landing above «Стоит» they pushed it and every
  // shelf below down (CLS 0.22). While the peer read settles, «Стоит» and the
  // shelves below wait too.
  it('while the peer boards settle, holds the shelves below', () => {
    const model = needsFromBoard(needsBoard(), [], [], NOW_MS, false, OWNER_ITEMS);
    const view = render(
      <MemoryRouter>
        <NeedsShelves model={model} stages={STAGES} settling />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /^Работает/ })).toBeNull();
    view.rerender(
      <MemoryRouter>
        <NeedsShelves model={model} stages={STAGES} settling={false} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /^Работает/ })).toBeTruthy();
  });

  it('shows three shelves, the first counting the same needs as the badge', () => {
    const { model } = show();
    expect(screen.getByRole('button', { name: `Нужно от меня ${model.count}` })).toBeTruthy();
    // two question gates + the mail ask; a card's question id without a link is the Mayor's (DIAG 20.11)
    expect(screen.getByRole('button', { name: 'Нужно от меня 3' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Работает 2' })).toBeTruthy();
    const quiet = screen.getByRole('button', { name: 'Тихо' });
    expect(quiet.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('ждут своей очереди или другую задачу')).toBeTruthy();
  });

  // vk11 (canvas Attention.dc.html / Phone-Needs.dc.html): one meta line
  // «держит 22 задачи, ждёт 3 дня», the epic breakdown, one action.
  it('a question row opens its card, with holds, wait, breakdown and read-only choices', () => {
    show();
    const item = itemOf(QUESTION_ID);
    const link = within(item).getAllByRole('link')[0]!;
    expect(link.getAttribute('href')).toBe(`/beads?bead=${QUESTION_ID}`);
    expect(within(link).getByText('Когда окно для переноса ящика на основной аккаунт?')).toBeTruthy();
    expect(within(link).getByText(/Gmail, доступ и собеседования/)).toBeTruthy();
    // graph sprint: the meta line sits under the card link; «держит 22 задачи»
    // is its own link to the graph of that chain.
    expect(within(item).getByTestId('need-meta').textContent).toBe('держит 22 задачи, ждёт 3 дня');
    expect(within(item).getByText('M04 10 · M03 4')).toBeTruthy();
    // Chips are read-only on the list: the decision happens inside the card.
    expect(within(item).getByText('Сегодня в 18:00').closest('button')).toBeNull();
  });

  it('«держит N задач» opens the graph of that chain (?view=graph&focus=<id>)', () => {
    show();
    const item = itemOf(QUESTION_ID);
    const holds = within(item).getByRole('link', { name: 'держит 22 задачи' });
    expect(holds.getAttribute('href')).toBe(`/beads?view=graph&focus=${QUESTION_ID}`);
  });

  it('a Mayor question row has exactly one action: «Ответить в Discord», filled brand-2', () => {
    show();
    const item = itemOf(QUESTION_ID);
    const buttons = within(item).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Ответить в Discord']);
    expect(buttons[0]!.className).toContain('bg-vk-brand-secondary');
    expect(buttons[0]!.className).toContain('h-7');
    expect(within(item).queryByText('Обсудить в Discord')).toBeNull();
  });

  it('an owner ask from mail is a card that opens its page', () => {
    show();
    const item = itemOf('mail:M-1:unread');
    const link = within(item).getByRole('link');
    expect(link.getAttribute('href')).toBe('/mail?message=M-1');
    expect(within(link).getByText('Нужен доступ к Supabase')).toBeTruthy();
    expect(within(link).getByText('Мэру нужен ключ сервиса, ждёт 4 ч')).toBeTruthy();
    expect(within(item).getByRole('button', { name: 'Обсудить в Discord' })).toBeTruthy();
  });

  // Owner 16.11: free tasks nobody took are a city alarm, not the owner's work.
  it('renders no «Стоит» section and no free stall rows', () => {
    const { container } = show();
    expect(screen.queryByRole('heading', { name: 'Стоит' })).toBeNull();
    expect(container.querySelector(`[data-need="${STALLED_ID}"]`)).toBeNull();
    expect(container.querySelector(`[data-need="${UNLINKED_ID}"]`)).toBeNull();
    expect(screen.queryByText('Миграция 0425')).toBeNull();
    expect(container.querySelector('[data-kind="stall"]')).toBeNull();
  });

  it('cuts reminders and PR states', () => {
    const { container } = show();
    expect(container.textContent).not.toMatch(/напомнит/);
    expect(container.textContent).not.toMatch(/\b(merged|checks)\b|PR открыт|влит|проверки/i);
    expect(container.querySelector('[target="_blank"]')).toBeNull();
  });

  it('opens «Тихо» on tap', () => {
    show();
    const quiet = screen.getByRole('button', { name: 'Тихо' });
    fireEvent.click(quiet);
    expect(quiet.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: 'dw-m03-0' })).toBeTruthy();
  });

  it('fits a phone: the root shrinks and no fixed widths', () => {
    const { container } = show();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toMatch(/\bmin-w-0\b/);
    expect(container.innerHTML).not.toMatch(/\bw-\[\d+px\]|\bmin-w-\[\d+px\]/);
  });

  // Owner 16.11: with «Стоит» gone the questions are one readable column, not edge to edge.
  it('wide screens: one readable column, no right column, no 2-up grid', () => {
    const { container } = show();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toContain('xl:grid-cols-2');
    expect(root.className).toMatch(/max-w-/);
    const list = itemOf(QUESTION_ID).parentElement as HTMLElement;
    expect(list.className).not.toContain('grid-cols-2');
  });

  // vk11: canvas type — phone question card 17 px medium; desktop row 15 px on one line.
  it('canvas type: 17 px question card on a phone, 15 px one-line row on desktop', () => {
    show();
    const title = within(itemOf(QUESTION_ID)).getByText('Когда окно для переноса ящика на основной аккаунт?');
    expect(title.className).toContain('text-[17px]');
    expect(title.className).toContain('md:text-[15px]');
    expect(title.className).toContain('md:truncate');
  });

  it('a stall held behind the question folds under it: «держит N задач ▸» expands it', () => {
    const model = needsFromBoard(needsBoardWithHeldStall(), [], [], NOW_MS, false, OWNER_ITEMS);
    render(
      <MemoryRouter>
        <NeedsShelves model={model} stages={STAGES} />
      </MemoryRouter>,
    );
    const question = itemOf(QUESTION_ID);
    expect(within(question).getByText(/держит 24 задачи/)).toBeTruthy();
    const toggle = within(question).getByRole('button', { name: /из них стоит/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(within(question).queryByText('Удалить mp_assignment после переноса ящика')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const row = within(question).getByRole('link', { name: /Удалить mp_assignment после переноса ящика/ });
    expect(row.getAttribute('href')).toBe(`/beads?bead=${HELD_STALL_ID}`);
  });

  it('«Обсудить в Discord» on a row is not faded when enabled', () => {
    show();
    const btn = within(itemOf('mail:M-1:unread')).getByRole('button', { name: 'Обсудить в Discord' });
    expect(btn.className).not.toMatch(/(^|\s)sm:opacity-70(\s|$)/);
  });

  it('drops a leading slug id from a row title and keeps the meta on one line', async () => {
    const { rowTitle } = await import('./NeedItem');
    expect(rowTitle('m03-d3-fixed-dispatch — фиксированный диспатч')).toBe('фиксированный диспатч');
    expect(rowTitle('Миграция 0425')).toBe('Миграция 0425');
    expect(rowTitle('M02 #7 — Выполнить 58 сценариев')).toBe('M02 #7 — Выполнить 58 сценариев');
    show();
    const meta = within(itemOf(QUESTION_ID)).getByTestId('need-meta');
    expect(meta.className).toContain('truncate');
  });
});
