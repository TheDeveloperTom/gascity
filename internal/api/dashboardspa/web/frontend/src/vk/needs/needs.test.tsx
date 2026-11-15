import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { TaskStages } from '../../hooks/useTaskStages';
import { setLocale } from '../../i18n';
import { needsFromBoard } from '../../lib/needsFromMe';
import { setActivityRole } from '../../embed/activitySession';
import { resetActivityPlumbingForTests } from '../../lib/apiBase';
import {
  NOW_MS,
  OWNER_ITEMS,
  QUESTION_ID,
  STALLED_ID,
  UNLINKED_ID,
  needsBoard,
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

  it('an Activity reader (Richard) sees the needs but no discuss or chat-answer action', () => {
    vi.stubEnv('VITE_EMBED', '1');
    setActivityRole('reader');
    try {
      show();
      expect(screen.queryByRole('button', { name: 'Обсудить в Discord' })).toBeNull();
      expect(within(itemOf(STALLED_ID)).getByText('Миграция 0425')).toBeTruthy();
      // The question still opens the drawer (where its choices are hidden too).
      expect(within(itemOf(QUESTION_ID)).getByRole('link').getAttribute('href')).toContain('bead=');
      for (const a of document.querySelectorAll('a')) {
        expect(a.getAttribute('href') ?? '').not.toMatch(/^https:\/\/discord\.com/);
      }
    } finally {
      vi.unstubAllEnvs();
      resetActivityPlumbingForTests();
    }
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
});
