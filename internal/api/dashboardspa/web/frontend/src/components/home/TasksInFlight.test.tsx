import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import type { TaskInFlight, TaskStages } from '../../hooks/useTaskStages';
import { setLocale } from '../../i18n';
import { TasksInFlight } from './TasksInFlight';

function row(i: number, extra: Partial<TaskInFlight> = {}): TaskInFlight {
  return {
    id: `dw-${i}`,
    title: `Задача номер ${i}`,
    stage: 'working',
    stepLabel: 'Inspect Superpowers implementation task',
    href: `/runs/R${i}`,
    ...extra,
  };
}

function stages(inFlight: TaskInFlight[], queued = 0, outsideWindow = 0): TaskStages {
  return { state: 'ready', inFlight, queued, outsideWindow };
}

function show(value: TaskStages) {
  return render(
    <MemoryRouter>
      <TasksInFlight stages={value} />
    </MemoryRouter>,
  );
}

describe('TasksInFlight', () => {
  afterEach(() => {
    cleanup();
    setLocale('en');
  });

  it('row names the task, not the id or the formula', () => {
    const { container } = show(
      stages([row(1, { title: 'Вход по ссылке', stage: 'review', stepLabel: 'Review round 1' })]),
    );
    const link = screen.getByRole('link', { name: 'Вход по ссылке: Review' });
    expect(link.getAttribute('href')).toBe('/runs/R1');
    expect(link.getAttribute('aria-label')).not.toMatch(/dw-/);
    expect(container.textContent).not.toContain('devwork-development');
    expect(within(link).getByText('Review, Review round 1')).toBeTruthy();
  });

  it('title is not truncated with an ellipsis', () => {
    const { container } = show(stages([row(1)]));
    expect(container.querySelector('.truncate')).toBeNull();
    const title = screen.getByText('Задача номер 1');
    expect(title.className).toContain('line-clamp-2');
    expect(title.getAttribute('title')).toBe('Задача номер 1');
  });

  it('stage dots are hidden and filled up to the stage', () => {
    const { container } = show(stages([row(1, { stage: 'pr' })]));
    const dots = container.querySelector('[data-stage-dots]');
    expect(dots?.getAttribute('aria-hidden')).toBe('true');
    expect(dots?.querySelectorAll('[data-filled="true"]')).toHaveLength(4);
    expect(dots?.children).toHaveLength(5);
  });

  it('folds after 8', () => {
    show(stages(Array.from({ length: 10 }, (_, i) => row(i))));
    expect(screen.getAllByRole('link', { name: /Задача номер/ })).toHaveLength(8);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 10' }));
    expect(screen.getAllByRole('link', { name: /Задача номер/ })).toHaveLength(10);
  });

  it('queued footer uses russian plural', () => {
    setLocale('ru');
    show(stages([row(1)], 16, 2));
    expect(screen.getByRole('heading', { name: 'Что идёт' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ещё 16 задач в очереди' }).getAttribute('href')).toBe(
      '/beads',
    );
    expect(
      screen.getByRole('link', { name: 'Ещё 2 прогона без задачи на доске' }).getAttribute('href'),
    ).toBe('/runs');
    expect(screen.getByRole('link', { name: 'Задача номер 1: Пишется код' })).toBeTruthy();
  });

  it('empty says nothing is going', () => {
    show(stages([]));
    expect(screen.getByText('Nothing is going on right now')).toBeTruthy();
  });

  it('loading says it is reading, never empty', () => {
    show({ state: 'loading', inFlight: [], queued: 0, outsideWindow: 0 });
    expect(screen.queryByText('Nothing is going on right now')).toBeNull();
    expect(screen.getByText('Reading the board…')).toBeTruthy();
  });
});
