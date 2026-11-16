import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardRead } from '../hooks/useBoardData';
import { collectMissing, resetMissing, setLocale } from '../i18n';
import { closeCommandBar, openCommandBar } from '../lib/commandBar';
import { CommandBar } from './CommandBar';

let board: BoardRead['data'];

vi.mock('../hooks/useBoardData', () => ({
  BOARD_RECENT_CLOSED_LIMIT: 100,
  useBoardData: (): Partial<BoardRead> => ({ data: board, loading: false, error: null }),
}));

function bead(id: string, extra: Partial<Bead> = {}): Bead {
  return { id, title: id, status: 'open', issue_type: 'task', created_at: '2026-11-15T10:00:00Z', ...extra };
}

function m03Board(): BoardRead['data'] {
  const items: Bead[] = [
    bead('dw-epic3', { issue_type: 'epic', title: 'M03 · Личный клиент, администратор, портал', labels: ['milestone:M03'] }),
    bead('dw-a', { title: 'Окно переноса ящика — ответ владельца', labels: ['milestone:M03'] }),
    bead('dw-b', { title: 'Второе окно настройки', labels: ['milestone:M03'] }),
    bead('dw-c', { title: 'Третье окно', labels: ['milestone:M03'], status: 'closed' }),
    bead('dw-d', { title: 'Допуск по собственному ящику пользователя', labels: ['milestone:M03'] }),
    ...Array.from({ length: 19 }, (_, i) => bead(`dw-x${i}`, { labels: ['milestone:M03'] })),
  ];
  return { items, routeItems: [], serviceItems: [], routesComplete: true, upstreamFetched: items.length };
}

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{`${loc.pathname}${loc.search}`}</output>;
}

function renderBar() {
  return render(
    <MemoryRouter initialEntries={['/start']}>
      <CommandBar />
      <Where />
    </MemoryRouter>,
  );
}

const ctrlK = () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

describe('CommandBar (⌘K)', () => {
  beforeEach(() => {
    board = m03Board();
    setLocale('ru');
    resetMissing();
  });
  afterEach(() => {
    act(() => closeCommandBar());
    cleanup();
  });

  // H1 16.11: the search field was 40 px tall on a phone (tap targets ≥ 44 px).
  it('the search field is a 44 px tap target on a phone', () => {
    renderBar();
    ctrlK();
    const input = within(screen.getByRole('dialog')).getByRole('combobox');
    expect(input.className.split(/\s+/)).toContain('h-11');
  });

  it('Ctrl+K opens it and Esc closes it', () => {
    renderBar();
    expect(screen.queryByRole('dialog')).toBeNull();
    ctrlK();
    const dialog = screen.getByRole('dialog', { name: 'Найти и перейти' });
    const input = within(dialog).getByRole('combobox', { name: 'Найти задачу, эпик или действие' });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(collectMissing()).toEqual([]);
  });

  it('typing «окно» filters tasks by title', () => {
    renderBar();
    ctrlK();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'окно' } });
    const tasks = screen.getByRole('group', { name: 'Задачи' });
    const names = within(tasks).getAllByRole('option').map((o) => o.textContent ?? '');
    expect(names).toHaveLength(3);
    expect(names.some((n) => n.includes('Допуск'))).toBe(false);
  });

  it('↓↓↵ on a task navigates to /beads?bead=<id>', () => {
    renderBar();
    ctrlK();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'окно' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const active = input.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    expect(document.getElementById(active ?? '')?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('where').textContent).toBe('/beads?bead=dw-c');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the epics section shows «M03 · … 1 из 23»', () => {
    renderBar();
    ctrlK();
    const epics = screen.getByRole('group', { name: 'Эпики' });
    const row = within(epics).getByRole('option');
    expect(row.textContent).toContain('M03 · Личный клиент, администратор, портал');
    expect(row.textContent).toContain('1 из 23');
  });

  it('openCommandBar() opens it', () => {
    renderBar();
    act(() => openCommandBar());
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('an action navigates home', () => {
    renderBar();
    ctrlK();
    fireEvent.click(screen.getByRole('option', { name: /Открыть «Нужно от меня»/ }));
    expect(screen.getByTestId('where').textContent).toBe('/');
  });

  it('with no board data it shows only actions and does not throw', () => {
    board = undefined;
    renderBar();
    ctrlK();
    expect(screen.queryByRole('group', { name: 'Задачи' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Эпики' })).toBeNull();
    const actions = screen.getByRole('group', { name: 'Действия' });
    expect(within(actions).getAllByRole('option').length).toBe(3);
    const discord = within(actions).getByRole('option', { name: /Обсудить с Мэром в Discord/ });
    expect(discord.getAttribute('aria-disabled')).toBe('true');
  });
});
