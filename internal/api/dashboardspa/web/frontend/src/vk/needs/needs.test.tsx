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
  it('while the peer boards settle, holds «Стоит» and the shelves below', () => {
    const model = needsFromBoard(needsBoard(), [], [], NOW_MS, false, OWNER_ITEMS);
    const view = render(
      <MemoryRouter>
        <NeedsShelves model={model} stages={STAGES} settling />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('heading', { level: 3, name: 'Стоит' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Работает/ })).toBeNull();
    view.rerender(
      <MemoryRouter>
        <NeedsShelves model={model} stages={STAGES} settling={false} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Стоит' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Работает/ })).toBeTruthy();
  });

  it('shows three shelves, the first counting the same needs as the badge', () => {
    const { model } = show();
    expect(screen.getByRole('button', { name: `Нужно от меня ${model.count}` })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Нужно от меня 4' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Работает 2' })).toBeTruthy();
    const quiet = screen.getByRole('button', { name: 'Тихо' });
    expect(quiet.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('ждут своей очереди или другую задачу')).toBeTruthy();
  });

  it('a question card opens as a whole, with holds, wait and read-only choices', () => {
    show();
    const item = itemOf(QUESTION_ID);
    const link = within(item).getByRole('link');
    expect(link.getAttribute('href')).toBe(`/beads?bead=${QUESTION_ID}`);
    expect(within(link).getByText('Когда окно для переноса ящика на основной аккаунт?')).toBeTruthy();
    expect(within(link).getByText(/Gmail, доступ и собеседования/)).toBeTruthy();
    expect(within(item).getByText('держит 22 задачи')).toBeTruthy();
    expect(within(item).getByText(/ждёт тебя 3 дня 8 ч/)).toBeTruthy();
    expect(within(item).getByText('M04 10 · M03 4')).toBeTruthy();
    // Chips are read-only on the list: the decision happens inside the card.
    expect(within(item).getByText('Сегодня в 18:00').closest('button')).toBeNull();
    expect(within(item).queryByText('Ответить в Discord')).toBeNull();
    expect(within(item).getByRole('button', { name: 'Обсудить в Discord' })).toBeTruthy();
  });

  it('an owner ask from mail is a card that opens its page', () => {
    show();
    const item = itemOf('mail:M-1:unread');
    const link = within(item).getByRole('link');
    expect(link.getAttribute('href')).toBe('/mail?message=M-1');
    expect(within(link).getByText('Нужен доступ к Supabase')).toBeTruthy();
    expect(within(link).getByText('Мэру нужен ключ сервиса')).toBeTruthy();
    expect(within(item).getByRole('button', { name: 'Обсудить в Discord' })).toBeTruthy();
  });

  it('stalls sit under «Стоит»; the owner-marked one is flagged as counted', () => {
    show();
    const stuck = screen.getByRole('heading', { level: 3, name: 'Стоит' }).closest('section');
    if (stuck === null) throw new Error('no «Стоит» section');
    expect(within(stuck).getByText('Миграция 0425')).toBeTruthy();
    expect(itemOf(UNLINKED_ID).getAttribute('data-for-owner')).toBe('true');
    expect(itemOf(STALLED_ID).getAttribute('data-for-owner')).toBe('false');
    expect(within(itemOf(UNLINKED_ID)).queryByRole('list')).toBeNull();
  });

  it('a stall shows «Обсудить» and no «Ответить»', () => {
    show();
    const item = itemOf(STALLED_ID);
    expect(within(item).getByText('Миграция 0425')).toBeTruthy();
    expect(within(item).getByText(/стоит 20 ч/)).toBeTruthy();
    expect(within(item).getByRole('button', { name: 'Обсудить в Discord' })).toBeTruthy();
    expect(within(item).queryByText(/Ответить/)).toBeNull();
  });

  it('never offers an unlinked question an answer, and cuts reminders and PR states', () => {
    const { container } = show();
    expect(container.textContent).not.toMatch(/Ответить/);
    expect(container.textContent).not.toMatch(/напомнит/);
    expect(itemOf(UNLINKED_ID).getAttribute('data-kind')).toBe('stall');
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

  // polish2 16.11 (owner, 2000 px screenshot)
  it('wide screens: two columns, «Нужно от меня» left and «Стоит» right; phones stay one column', () => {
    const { container } = show();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('xl:grid-cols-2');
    const [left, right] = Array.from(root.children) as HTMLElement[];
    expect(within(left!).getByRole('button', { name: /Нужно от меня/ })).toBeTruthy();
    expect(within(right!).getByRole('heading', { level: 3, name: 'Стоит' })).toBeTruthy();
    expect(within(left!).queryByRole('heading', { level: 3, name: 'Стоит' })).toBeNull();
  });

  it('larger type on desktop', () => {
    show();
    const title = within(itemOf(QUESTION_ID)).getByText('Когда окно для переноса ящика на основной аккаунт?');
    expect(title.className).toContain('xl:text-[17px]');
  });

  it('a stall held behind the question folds under it: «держит N задач ▸» expands it', () => {
    const model = needsFromBoard(needsBoardWithHeldStall(), [], [], NOW_MS, false, OWNER_ITEMS);
    render(
      <MemoryRouter>
        <NeedsShelves model={model} stages={STAGES} />
      </MemoryRouter>,
    );
    const stuck = screen.getByRole('heading', { level: 3, name: 'Стоит' }).closest('section')!;
    expect(within(stuck).queryByText('Удалить mp_assignment после переноса ящика')).toBeNull();
    const question = itemOf(QUESTION_ID);
    const toggle = within(question).getByRole('button', { name: /держит 24 задачи/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(within(question).queryByText('Удалить mp_assignment после переноса ящика')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const row = within(question).getByRole('link', { name: /Удалить mp_assignment после переноса ящика/ });
    expect(row.getAttribute('href')).toBe(`/beads?bead=${HELD_STALL_ID}`);
  });
});
