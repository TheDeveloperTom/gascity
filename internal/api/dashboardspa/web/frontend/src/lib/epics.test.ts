import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import { describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import { epicSummaries, milestoneRangeLabel, NO_EPIC, plannedEmptyMilestones } from './epics';

function bead(id: string, extra: Partial<Bead> = {}): Bead {
  return {
    id,
    title: id,
    status: 'open',
    issue_type: 'task',
    created_at: '2026-11-15T10:00:00Z',
    ...extra,
  };
}

function tasks(milestone: string, n: number, closed: number): Bead[] {
  return Array.from({ length: n }, (_, i) =>
    bead(`${milestone}-${i}`, {
      labels: [`milestone:${milestone}`],
      status: i < closed ? 'closed' : 'open',
    }),
  );
}

describe('epicSummaries', () => {
  it('counts done and total per milestone', () => {
    const out = epicSummaries(tasks('M04', 21, 7));
    expect(out).toEqual([{ key: 'M04', name: null, done: 7, total: 21, approx: false }]);
  });

  it('takes the name from the epic bead and does not count the epic itself', () => {
    const epic = bead('dw-epic4', {
      issue_type: 'epic',
      title: 'M04 · Понимание вакансии',
      labels: ['milestone:M04'],
    });
    const [m04] = epicSummaries([epic, ...tasks('M04', 3, 1)]);
    expect(m04).toEqual({ key: 'M04', name: 'Понимание вакансии', done: 1, total: 3, approx: false });
  });

  // H1 16.11 (live «Эпик» menu): «M00 · . Закрыть границы…», «M05 · / 0c+. …» —
  // the live epics are titled «M00. …» and «M05 / 0c+. …».
  it.each([
    ['M00. Закрыть границы проекта', 'Закрыть границы проекта'],
    ['M05 / 0c+. Закончить каталог', '0c+. Закончить каталог'],
    ['M01: строгий прогон тестов', 'строгий прогон тестов'],
  ])('drops the key and its separator from «%s»', (title, name) => {
    const epic = bead('dw-epic', { issue_type: 'epic', title, labels: [`milestone:${title.slice(0, 3)}`] });
    const [summary] = epicSummaries([epic, ...tasks(title.slice(0, 3), 1, 0)]);
    expect(summary?.name).toBe(name);
  });

  it('sorts by milestone number and marks approx when closed is capped', () => {
    const out = epicSummaries([...tasks('M10', 1, 0), ...tasks('M03', 2, 1)], { closedCapped: true });
    expect(out.map((e) => e.key)).toEqual(['M03', 'M10']);
    expect(out.every((e) => e.approx)).toBe(true);
  });

  it('appends a NO_EPIC entry for tasks without a milestone', () => {
    setLocale('ru');
    const out = epicSummaries([...tasks('M01', 1, 1), bead('fix-1'), bead('fix-2', { status: 'closed' })]);
    expect(out.at(-1)).toEqual({
      key: NO_EPIC,
      name: 'Без эпика — починки и мелочи',
      done: 1,
      total: 2,
      approx: false,
    });
  });

  it('ignores service and route beads', () => {
    const out = epicSummaries([bead('svc', { issue_type: 'message' }), bead('g', { labels: ['gc:x'] })]);
    expect(out).toEqual([]);
  });

  it('gives [] for an empty input', () => {
    expect(epicSummaries([])).toEqual([]);
  });
});

describe('planned milestones without tasks', () => {
  it('lists epic beads whose milestone has no tasks, as a range', () => {
    const items = [
      ...tasks('M04', 2, 0),
      bead('e5', { issue_type: 'epic', labels: ['milestone:M05'] }),
      bead('e13', { issue_type: 'epic', labels: ['milestone:M13'] }),
      bead('e4', { issue_type: 'epic', labels: ['milestone:M04'] }),
    ];
    const empty = plannedEmptyMilestones(items);
    expect(empty).toEqual(['M05', 'M13']);
    expect(milestoneRangeLabel(empty)).toBe('M05–M13');
    expect(milestoneRangeLabel(['M07'])).toBe('M07');
    expect(milestoneRangeLabel([])).toBeNull();
  });
});
