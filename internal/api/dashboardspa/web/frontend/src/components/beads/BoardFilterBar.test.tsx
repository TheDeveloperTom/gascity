import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectMissing, resetMissing, setLocale } from '../../i18n';
import type { BoardSource } from '../../lib/boardOwner';
import { type EpicSummary, NO_EPIC } from '../../lib/epics';
import { BoardFilterBar } from './BoardFilterBar';

const ME: BoardSource = { owner: 'me', label: 'Mine', available: true };
// vk-final: a peer source is labelled with the person's genitive («Ричарда»).
const RICHARD: BoardSource = { owner: 'peer:rich', label: 'Ричарда', available: true };
const EPICS: EpicSummary[] = [
  { key: 'M03', name: 'Личный клиент', done: 1, total: 23, approx: false },
  { key: 'M04', name: 'Понимание вакансии', done: 7, total: 21, approx: false },
  { key: NO_EPIC, name: 'Без эпика — починки и мелочи', done: 0, total: 4, approx: false },
];

function renderBar(extra: Partial<ComponentProps<typeof BoardFilterBar>> = {}) {
  const props: ComponentProps<typeof BoardFilterBar> = {
    projects: [],
    project: 'all',
    onProject: vi.fn(),
    search: '',
    onSearch: vi.fn(),
    matched: 0,
    total: 0,
    testCount: 0,
    showTests: false,
    onShowTests: vi.fn(),
    ...extra,
  };
  render(<BoardFilterBar {...props} />);
  return props;
}

const SYNC_TITLE = 'Появится после синхронизации с городом Ричарда';

describe('BoardFilterBar (vk)', () => {
  beforeEach(() => {
    setLocale('ru');
    resetMissing();
  });
  afterEach(cleanup);

  it('«Мои» and «Ричарда» are disabled with one source', () => {
    renderBar({ sources: [ME], ownerFilter: 'all', onOwnerFilter: vi.fn() });
    const all = screen.getByRole('button', { name: 'Все' });
    expect(all.getAttribute('aria-pressed')).toBe('true');
    for (const name of ['Мои', 'Ричарда']) {
      const chip = screen.getByRole('button', { name }) as HTMLButtonElement;
      expect(chip.disabled).toBe(true);
      expect(chip.title).toBe(SYNC_TITLE);
    }
    expect(collectMissing()).toEqual([]);
  });

  it('enables them with two sources', () => {
    const onOwnerFilter = vi.fn();
    renderBar({ sources: [ME, RICHARD], ownerFilter: 'all', onOwnerFilter });
    const mine = screen.getByRole('button', { name: 'Мои' }) as HTMLButtonElement;
    expect(mine.disabled).toBe(false);
    expect(mine.title).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Ричарда' }));
    expect(onOwnerFilter).toHaveBeenCalledWith('peer:rich');
    expect(screen.getAllByRole('button', { name: 'Ричарда' })).toHaveLength(1);
  });

  it('choosing M04 calls onEpic', () => {
    const onEpic = vi.fn();
    renderBar({ epics: EPICS, epic: 'all', onEpic });
    fireEvent.click(screen.getByRole('button', { name: /Эпик:/ }));
    expect(screen.getByRole('option', { name: /Без эпика — починки и мелочи/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: /M04 · Понимание вакансии/ }));
    expect(onEpic).toHaveBeenCalledWith('M04');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  // H1 16.11: at 390/360 px the «Эпик» button sits right of «Все Мои Ричарда»,
  // and its 320 px menu, anchored to the button's left edge, ran off the
  // screen (right edge at 523 px). Both menus now shift left to stay 16 px
  // inside the viewport.
  it.each([
    ['Эпик', /Эпик:/, { epics: EPICS, epic: 'all', onEpic: vi.fn() }],
    ['Проект', /Проект:/, { projects: [{ key: 'all', label: 'Все', count: 5 }, { key: 'devwork', label: 'devwork', count: 3 }, { key: 'city', label: 'Город', count: 2 }] }],
  ] as const)('the %s menu stays inside a phone-wide viewport', (_name, button, extra) => {
    // A phone's layout viewport is 390 px, but when a menu overflows, mobile
    // Chrome zooms out and window.innerWidth grows to fit it (measured: the
    // live sweep at 390 px still ended at 507 px with an innerWidth check).
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 523 });
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 390 });
    const rect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.getAttribute('role') === 'listbox') {
        return { x: 203, y: 0, left: 203, top: 0, right: 523, bottom: 300, width: 320, height: 300, toJSON: () => ({}) };
      }
      return rect.call(this);
    };
    try {
      renderBar(extra as Partial<ComponentProps<typeof BoardFilterBar>>);
      fireEvent.click(screen.getByRole('button', { name: button }));
      // 523 - (390 - 16) = 149 px to the left
      // The layout box moves (a transform left the page 133 px wide to scroll on the live phone).
      expect((screen.getByRole('listbox') as HTMLElement).style.left).toBe('-149px');
    } finally {
      HTMLElement.prototype.getBoundingClientRect = rect;
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      delete (document.documentElement as { clientWidth?: number }).clientWidth;
    }
  });

  // H1 16.11: «Найти задачу» was 40 px tall on a phone (tap targets ≥ 44 px).
  it('the search field is a 44 px tap target on a phone', () => {
    renderBar();
    const field = screen.getByRole('searchbox');
    expect(field.className.split(/\s+/)).toContain('h-11');
  });

  it('the epic button names the chosen epic with its progress', () => {
    renderBar({ epics: EPICS, epic: 'M04', onEpic: vi.fn() });
    expect(screen.getByRole('button', { name: /Эпик:/ }).textContent).toContain('M04 · 7 из 21');
  });

  it('with no epics the button reads «Эпик: Все» and does not throw', () => {
    renderBar();
    const button = screen.getByRole('button', { name: /Эпик:/ });
    expect(button.textContent).toBe('Эпик: Все');
    fireEvent.click(button);
    expect(screen.getByRole('option', { name: 'Все задачи' })).toBeTruthy();
  });

  it('the epic list notes planned milestones with no tasks («M05–M13 плана ещё нет»)', () => {
    renderBar({ epics: EPICS, plannedEmpty: 'M05–M13' });
    fireEvent.click(screen.getByRole('button', { name: /Эпик:/ }));
    const note = screen.getByText('M05–M13').parentElement as HTMLElement;
    expect(note.getAttribute('aria-disabled')).toBe('true');
    expect(note.textContent).toContain('плана ещё нет');
    expect(note.getAttribute('role')).toBeNull();
    expect(collectMissing()).toEqual([]);
  });

  it('«Новая задача» is a link to newTaskUrl', () => {
    renderBar({ newTaskUrl: 'https://discord.com/channels/1/2' });
    const link = screen.getByRole('link', { name: /Новая задача/ });
    expect(link.getAttribute('href')).toBe('https://discord.com/channels/1/2');
    expect(link.getAttribute('target')).toBeNull();
  });

  it('«Новая задача» is disabled when there is no Mayor channel', () => {
    renderBar({ newTaskUrl: null });
    const button = screen.getByRole('button', { name: /Новая задача/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Канал Мэра не настроен');
  });

  it('no «Новая задача» until the page passes newTaskUrl', () => {
    renderBar();
    expect(screen.queryByText('Новая задача')).toBeNull();
  });

  // vk-final part 2: the project chips became «Проект: Все ▾» beside «Эпик».
  const PROJECTS = [
    { key: 'all', label: 'Все', count: 229 },
    { key: 'devwork', label: 'devwork', count: 225 },
    { key: 'city', label: 'Город', count: 4 },
  ];

  it('the project control is a «Проект: Все ▾» menu with counts inside', () => {
    const onProject = vi.fn();
    renderBar({ projects: PROJECTS, onProject, epics: EPICS });
    expect(screen.queryByRole('group', { name: 'Проект' })).toBeNull();
    const button = screen.getByRole('button', { name: /Проект:/ });
    expect(button.textContent).toBe('Проект: Все');
    expect(button.getAttribute('aria-haspopup')).toBe('listbox');
    // it sits right after the epic control
    const epicButton = screen.getByRole('button', { name: /Эпик:/ });
    expect(epicButton.parentElement?.nextElementSibling?.contains(button)).toBe(true);
    fireEvent.click(button);
    const list = screen.getByRole('listbox', { name: 'Выбрать проект' });
    const options = Array.from(list.querySelectorAll('[role="option"]')).map((o) => o.textContent);
    expect(options).toEqual(['Все229', 'devwork225', 'Город4']);
    fireEvent.click(screen.getByRole('option', { name: /devwork/ }));
    expect(onProject).toHaveBeenCalledWith('devwork');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(collectMissing()).toEqual([]);
  });

  it('the project button names the chosen project', () => {
    renderBar({ projects: PROJECTS, project: 'city' });
    expect(screen.getByRole('button', { name: /Проект:/ }).textContent).toBe('Проект: Город');
  });

  it('no project control with one project', () => {
    renderBar({ projects: PROJECTS.slice(0, 2) });
    expect(screen.queryByRole('button', { name: /Проект:/ })).toBeNull();
  });

  it('search is «Найти задачу…»', () => {
    const props = renderBar();
    const box = screen.getByRole('searchbox', { name: 'Найти задачу' }) as HTMLInputElement;
    expect(box.placeholder).toBe('Найти задачу…');
    fireEvent.change(box, { target: { value: 'окно' } });
    expect(props.onSearch).toHaveBeenCalledWith('окно');
    expect(collectMissing()).toEqual([]);
  });
});
