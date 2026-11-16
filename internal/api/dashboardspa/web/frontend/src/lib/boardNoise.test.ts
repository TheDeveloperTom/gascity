import { describe, expect, it } from 'vitest';
import type { SupervisorBead } from '../supervisor/beadReads';
import { isBoardNoise } from './boardNoise';

function bead(title: string, extra: Partial<SupervisorBead> = {}): SupervisorBead {
  return { id: 'dw-x', title, status: 'open', issue_type: 'task', created_at: '2026-11-16T08:00:00Z', ...extra };
}

describe('isBoardNoise (VK 1:1: the board shows work items only)', () => {
  it.each([
    'Ревью плана M04 — круг 2',
    'Repair PR #489: CI красный (unit, web-ui), ветка позади main',
    'Доработка по провалу ворот Refinery, раунд 1: M04 #3 — Сделать invalid',
    'стоит: dw-m53l7 (M00 #1) с 18:44 UTC',
  ])('hides «%s»', (title) => {
    expect(isBoardNoise(bead(title))).toBe(true);
  });

  // Fix I1 (REVIEW 16.11): a PR repair or gate rework an agent is on is live
  // work; it shows as a normal card while in progress or assigned.
  it.each([
    'Repair PR #489: CI красный (unit, web-ui), ветка позади main',
    'Доработка по провалу ворот Refinery, раунд 1: M04 #3 — Сделать invalid',
  ])('keeps «%s» while an agent is on it', (title) => {
    expect(isBoardNoise(bead(title, { status: 'in_progress' }))).toBe(false);
    expect(isBoardNoise(bead(title, { assignee: 'gcg-session-9570720d' }))).toBe(false);
    expect(isBoardNoise(bead(title, { assignee: '  ' }))).toBe(true);
  });

  it('a stall alarm stays noise even when in progress', () => {
    expect(isBoardNoise(bead('стоит: dw-m53l7 (M00 #1) с 18:44 UTC', { status: 'in_progress' }))).toBe(true);
  });

  it.each(['convoy', 'molecule', 'step', 'gate'])('hides engine type %s', (type) => {
    expect(isBoardNoise(bead('anything', { issue_type: type }))).toBe(true);
  });

  it('hides alarm beads by their engine metadata', () => {
    expect(isBoardNoise(bead('ждут решения человека: 7 задач', { metadata: { 'devwork.intake_needs_person': '7' } }))).toBe(true);
    expect(isBoardNoise(bead('anything', { metadata: { 'devwork.stopped_card': 'dw-1' } }))).toBe(true);
  });

  it.each([
    'M04 #3 — инвалидация при изменении вакансии',
    'Удалить таблицы и данные наставничества',
    'Ревью кода PR #580',
    'Пакет этапа M05: исполнимый план',
  ])('keeps work «%s»', (title) => {
    expect(isBoardNoise(bead(title))).toBe(false);
  });
});
