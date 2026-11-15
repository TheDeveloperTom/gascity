import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BeadStatus } from 'gas-city-dashboard-shared';
import { setLocale } from '../../i18n';
import { ALL_PROJECTS, buildBoardModel } from '../../lib/boardModel';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { LIVE_7LPZG7, LIVE_MQFCX13 } from '../../test/fixtures/liveCards';
import { boardData, renderBoard } from '../../test/renderBoard';
import { PhoneBoard } from './PhoneBoard';

vi.mock('../../lib/openExternal', () => ({ openExternal: vi.fn() }));
import { openExternal } from '../../lib/openExternal';

// vk lane 1: the VK board (Main / Board-M04 / Cards / Phone-Board frames).

const NOW = Date.parse('2026-11-15T10:40:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

beforeEach(() => {
  setLocale('ru');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  setLocale('en');
  vi.mocked(openExternal).mockClear();
});

function bead(id: string, status: BeadStatus, extra: Partial<SupervisorBead> = {}): SupervisorBead {
  return {
    id,
    title: `bead ${id}`,
    status,
    issue_type: 'task',
    created_at: ago(30 * DAY),
    updated_at: ago(10 * 60_000),
    ...extra,
  };
}

const column = (name: string) => screen.getByRole('region', { name });

describe('VK board', () => {
  it('renders four columns with a pr card inside Ревью', () => {
    renderBoard([bead('dw-a', 'open'), LIVE_MQFCX13, LIVE_7LPZG7], { nowMs: NOW });
    const names = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(names).toEqual(['Ждёт', 'В работе', 'Ревью', 'Влито · за 7 дней']);
    expect(within(column('Ревью')).getByText(/миграция 0425/, { selector: 'span' })).toBeTruthy();
  });

  it('«Показать старые» reveals cards older than 7 days', () => {
    renderBoard(
      [
        bead('dw-new', 'closed', { title: 'fresh merge', updated_at: ago(DAY) }),
        bead('dw-old', 'closed', { title: 'old merge', updated_at: ago(9 * DAY) }),
      ],
      { nowMs: NOW },
    );
    const merged = column('Влито · за 7 дней');
    expect(within(merged).getByText('fresh merge')).toBeTruthy();
    expect(within(merged).queryByText('old merge')).toBeNull();
    fireEvent.click(within(merged).getByRole('button', { name: 'Показать старые' }));
    expect(within(merged).getByText('old merge')).toBeTruthy();
  });

  it('shows «нужен ты», «срочно» and «стоит 2 ч»', () => {
    renderBoard(
      [
        bead('dw-q', 'open', { title: 'question', labels: ['needs/operator'] }),
        bead('dw-p1', 'open', { title: 'hot', priority: 1 }),
        bead('dw-st', 'in_progress', { title: 'stalled', updated_at: ago(2 * HOUR) }),
      ],
      { nowMs: NOW },
    );
    const card = (title: string) => screen.getByText(title).closest('article') as HTMLElement;
    expect(within(card('question')).getByText('нужен ты')).toBeTruthy();
    expect(within(card('hot')).getByText('срочно')).toBeTruthy();
    expect(within(card('stalled')).getByText('стоит 2 ч')).toBeTruthy();
  });

  it('the blocker badge names the blocker by its milestone tag', () => {
    const blocker = bead('dw-b', 'open', { title: 'Blocker task', labels: ['milestone:M04'] });
    const waiter = bead('dw-w', 'open', {
      title: 'Waiter task',
      is_blocked: true,
      dependencies: [{ issue_id: 'dw-w', depends_on_id: 'dw-b', type: 'blocks' }],
    });
    renderBoard([blocker, waiter], { nowMs: NOW });
    const card = screen.getByText('Waiter task').closest('article') as HTMLElement;
    const badge = card.querySelector('[data-relationship="blocked_by"]') as HTMLElement;
    expect(badge.textContent).toContain('M04');
    expect(badge.textContent).toContain('ждёт:');
    const holder = screen.getByText('Blocker task').closest('article') as HTMLElement;
    expect(holder.querySelector('[data-relationship="blocks"]')?.textContent).toContain('блокирует:');
  });

  it('the PR link calls openExternal and has no target', () => {
    renderBoard([LIVE_MQFCX13, LIVE_7LPZG7], { nowMs: NOW });
    const link = within(column('Ревью')).getByRole('link', { name: '#489' });
    expect(link.getAttribute('target')).toBeNull();
    fireEvent.click(link);
    expect(openExternal).toHaveBeenCalledWith(
      'https://github.com/TheDeveloperTom/career-ops-platform/pull/489',
    );
  });

  it.each([['javascript:alert(1)'], ['data:text/html,x'], ['garbage']])(
    'an unsafe PR url %s renders as plain text, never a link',
    (url) => {
      const land = { ...LIVE_7LPZG7, metadata: { ...LIVE_7LPZG7.metadata, pr_url: url } };
      renderBoard([LIVE_MQFCX13, land], { nowMs: NOW });
      expect(screen.queryByRole('link', { name: '#489' })).toBeNull();
      expect(within(column('Ревью')).getByText('#489').closest('a')).toBeNull();
      expect(document.querySelector(`a[href="${url}"]`)).toBeNull();
    },
  );

  it('a click selects the card; the selected card scrolls into view', () => {
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scroll,
    });
    const { onSelect } = renderBoard([bead('dw-pick', 'open', { title: 'pick me' })], {
      nowMs: NOW,
      selectedId: 'dw-pick',
    });
    expect(scroll).toHaveBeenCalled();
    fireEvent.click(screen.getByText('pick me'));
    expect(onSelect).toHaveBeenCalledWith('dw-pick');
    expect(screen.getByTitle('Открыть задачу dw-pick').getAttribute('aria-pressed')).toBe('true');
  });

  it('a 150-character title without spaces wraps anywhere', () => {
    const long = 'Д'.repeat(150);
    renderBoard([bead('dw-long', 'open', { title: long })], { nowMs: NOW });
    expect(screen.getByText(long).className).toContain('[overflow-wrap:anywhere]');
  });

  it('a working card with a live session shows running dots', () => {
    renderBoard([bead('dw-run', 'in_progress', { title: 'running', assignee: 'devwork/worker' })], {
      nowMs: NOW,
      sessions: [{ id: 's1', session_name: 'devwork/worker', state: 'active' }],
    });
    const card = screen.getByText('running').closest('article') as HTMLElement;
    expect(within(card).getByRole('img', { name: 'агент работает' })).toBeTruthy();
  });
});

describe('PhoneBoard', () => {
  function renderPhone(beads: SupervisorBead[]) {
    const model = buildBoardModel(boardData(beads), [], {
      project: ALL_PROJECTS,
      search: '',
      showTests: false,
    });
    return render(
      <MemoryRouter>
        <PhoneBoard model={model} nowMs={NOW} selectedId={null} onSelect={vi.fn()} />
      </MemoryRouter>,
    );
  }

  it('tapping the «Ревью» chip shows only review cards', () => {
    renderPhone([bead('dw-wait', 'open', { title: 'waiting one' }), LIVE_MQFCX13, LIVE_7LPZG7]);
    expect(screen.getByText('waiting one')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Ревью/ }));
    expect(screen.queryByText('waiting one')).toBeNull();
    expect(screen.getByText(/миграция 0425/, { selector: 'span' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Ревью/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('an empty model renders without throwing', () => {
    renderPhone([]);
    expect(screen.getByRole('button', { name: /^Ждёт/ })).toBeTruthy();
    expect(screen.getByText('Здесь пусто')).toBeTruthy();
  });
});
