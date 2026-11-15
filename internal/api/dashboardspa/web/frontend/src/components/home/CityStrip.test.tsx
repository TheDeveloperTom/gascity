import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import type { AttentionItem } from '../../attention/compose';
import type { TaskStages } from '../../hooks/useTaskStages';
import { setLocale } from '../../i18n';
import { CityStrip } from './CityStrip';
import { TasksInFlight } from './TasksInFlight';

const tasks: TaskStages = {
  state: 'ready',
  inFlight: [
    { id: 'dw-1', title: 'Вход по ссылке', stage: 'review', stepLabel: null, href: '/runs/R1' },
    { id: 'dw-2', title: 'Тарифы', stage: 'working', stepLabel: null, href: '/runs/R2' },
  ],
  queued: 16,
  outsideWindow: 0,
};

function issue(i: number): AttentionItem {
  return {
    id: `health:${i}`,
    domain: 'health',
    severity: 'attention',
    title: `Неполадка ${i}`,
    summary: `подробности ${i}`,
    href: '/health',
  };
}

type Props = Parameters<typeof CityStrip>[0];

function show(props: Partial<Props> = {}) {
  return render(
    <MemoryRouter>
      <CityStrip
        agents={{ running: 2, total: 15 }}
        tasks={tasks}
        issues={[]}
        unreadable={[]}
        readiness={{ state: 'ready' }}
        {...props}
      />
    </MemoryRouter>,
  );
}

function valueOf(term: string): HTMLElement {
  const dt = screen.getByText(term, { selector: 'dt' });
  return dt.nextElementSibling as HTMLElement;
}

describe('CityStrip', () => {
  afterEach(() => {
    cleanup();
    setLocale('en');
  });

  it('task count equals the list Task 6 renders', () => {
    setLocale('ru');
    render(
      <MemoryRouter>
        <TasksInFlight stages={tasks} />
        <CityStrip
          agents={{ running: 2, total: 15 }}
          tasks={tasks}
          issues={[]}
          unreadable={[]}
          readiness={{ state: 'ready' }}
        />
      </MemoryRouter>,
    );
    expect(valueOf('Задачи').textContent).toContain('2 в работе, 16 в очереди');
    expect(screen.getAllByRole('link', { name: /: (Ревью|Пишется код)$/ })).toHaveLength(2);
    expect(valueOf('Агенты').textContent).toContain('2 из 15 работают');
  });

  it('unreadable status is not zero', () => {
    setLocale('ru');
    show({ agents: 'unavailable' });
    expect(valueOf('Агенты').textContent).toBe('не удалось прочитать');
    expect(valueOf('Агенты').textContent).not.toMatch(/0 из 0/);
  });

  it('unreadable board says so in the tasks row', () => {
    show({ tasks: { state: 'unavailable', inFlight: [], queued: 0, outsideWindow: 0 } });
    expect(valueOf('Tasks').textContent).toBe('could not read');
  });

  // Review I-3: no zero stands in for "not read yet".
  it('issues are not zero while the city reads load', () => {
    show({ readiness: { state: 'loading' } });
    const problems = valueOf('Problems');
    expect(problems.querySelector('[data-count]')).toBeNull();
    expect(problems.textContent).toContain('reading…');
    expect(problems.textContent).not.toMatch(/\b0\b/);
  });

  it('degraded city reads show the count and name what failed', () => {
    setLocale('ru');
    show({
      issues: [issue(1)],
      readiness: { state: 'degraded', reasons: ['City health could not be read'] },
    });
    expect(valueOf('Неполадки').querySelector('[data-count]')?.textContent).toBe('1');
    expect(screen.getByText('Не удалось проверить: здоровье города не прочиталось.')).toBeTruthy();
  });

  it('loading tasks are not zero either', () => {
    show({
      tasks: { state: 'loading', inFlight: [], queued: 0, outsideWindow: 0 },
      agents: 'loading',
    });
    expect(valueOf('Tasks').textContent).toBe('reading…');
    expect(valueOf('Agents').textContent).toBe('reading…');
  });

  it('no middle dot anywhere', () => {
    const { container } = show({
      issues: [issue(1)],
      unreadable: [
        { id: 'u', domain: 'mail', severity: 'unavailable', title: 'Mail list incomplete' },
      ],
    });
    expect(container.textContent).not.toContain('·');
  });

  it('issues amber only when present', () => {
    show();
    const none = valueOf('Problems').querySelector('[data-count]');
    expect(none?.textContent).toBe('0');
    expect(none?.className).not.toContain('text-warn');
    cleanup();
    show({ issues: [issue(1), issue(2)] });
    const some = valueOf('Problems').querySelector('[data-count]');
    expect(some?.textContent).toBe('2');
    expect(some?.className).toContain('text-warn');
    expect(screen.getByRole('link', { name: 'Health' }).getAttribute('href')).toBe('/health');
  });

  it('folds after 3', () => {
    show({ issues: [1, 2, 3, 4, 5].map(issue) });
    expect(screen.getAllByText(/^Неполадка \d$/)).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 5' }));
    expect(screen.getAllByText(/^Неполадка \d$/)).toHaveLength(5);
  });

  it('unreadable items are one faint line', () => {
    setLocale('ru');
    show({
      unreadable: [
        { id: 'a', domain: 'mail', severity: 'unavailable', title: 'Mail list incomplete' },
        { id: 'b', domain: 'runs', severity: 'unavailable', title: 'Run list incomplete' },
      ],
    });
    expect(
      screen.getByText('Не удалось прочитать: Mail list incomplete, Run list incomplete'),
    ).toBeTruthy();
  });
});
