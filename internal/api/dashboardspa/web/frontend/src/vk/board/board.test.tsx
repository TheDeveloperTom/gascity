import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BeadStatus } from 'gas-city-dashboard-shared';
import { setLocale } from '../../i18n';
import { ALL_PROJECTS, buildBoardModel } from '../../lib/boardModel';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { LIVE_7LPZG7, LIVE_MQFCX13 } from '../../test/fixtures/liveCards';
import { boardData, renderBoard } from '../../test/renderBoard';
import { KanbanCard } from './KanbanCard';
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
    expect(within(column('Ревью')).getAllByText(/миграция 0425/i, { selector: 'button span' })[0]).toBeTruthy();
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

  // VK 1:1 (Main.dc.html): «Влито · за 7 дней» shows the newest three; the
  // rest of the week and older merges sit behind «Показать старые».
  it('«Влито» shows the newest three merges, the count is the whole week', () => {
    renderBoard(
      [1, 2, 3, 4, 5].map((n) => bead(`dw-m${n}`, 'closed', { title: `merge ${n}`, updated_at: ago(n * HOUR) })),
      { nowMs: NOW },
    );
    const merged = column('Влито · за 7 дней');
    const titles = Array.from(merged.querySelectorAll('article')).map((a) => a.textContent ?? '');
    expect(titles).toHaveLength(3);
    expect(titles[0]).toContain('merge 1');
    expect(within(merged).queryByText('merge 4')).toBeNull();
    expect(merged.querySelector('.tnum')?.textContent).toBe('5');
    fireEvent.click(within(merged).getByRole('button', { name: 'Показать старые' }));
    expect(within(merged).getByText('merge 5')).toBeTruthy();
  });

  // VK 1:1 (Main.dc.html): a column header is dot + name + count + «+».
  it('every column header has its «+» button, «Добавить в «…»»', () => {
    renderBoard([bead('dw-a', 'open')], { nowMs: NOW });
    for (const name of ['Ждёт', 'В работе', 'Ревью', 'Влито · за 7 дней']) {
      expect(within(column(name)).getByRole('button', { name: `Добавить в «${name}»` })).toBeTruthy();
    }
  });

  it('shows «ждёт тебя», «срочно» and «стоит 2 ч» with a clock (canvas Cards)', () => {
    renderBoard(
      [
        bead('dw-q', 'open', { title: 'question', labels: ['needs/operator'] }),
        bead('dw-p1', 'open', { title: 'hot', priority: 1 }),
        bead('dw-st', 'in_progress', { title: 'stalled', updated_at: ago(2 * HOUR) }),
      ],
      { nowMs: NOW },
    );
    const card = (title: string) => screen.getByText(title).closest('article') as HTMLElement;
    expect(within(card('question')).getByText('ждёт тебя')).toBeTruthy();
    expect(within(card('hot')).getByText('срочно')).toBeTruthy();
    const stalled = within(card('stalled')).getByText('стоит 2 ч');
    expect(stalled.querySelector('svg')).toBeTruthy();
  });

  it('the blocker chip is icon + short label, no «ждёт:»/«блокирует:» prefix (canvas)', () => {
    const blocker = bead('dw-b', 'open', { title: 'M04 #3 / Task 3: Blocker task', labels: ['milestone:M04'] });
    const waiter = bead('dw-w', 'open', {
      title: 'Waiter task',
      is_blocked: true,
      dependencies: [{ issue_id: 'dw-w', depends_on_id: 'dw-b', type: 'blocks' }],
    });
    renderBoard([blocker, waiter], { nowMs: NOW });
    const card = screen.getByText('Waiter task', { selector: 'button span' }).closest('article') as HTMLElement;
    const badge = card.querySelector('[data-relationship="blocked_by"]') as HTMLElement;
    expect(badge.textContent).toBe('M04 #3');
    expect(badge.querySelector('svg circle')).toBeTruthy();
    const holder = screen.getByText('Blocker task', { selector: 'button span' }).closest('article') as HTMLElement;
    expect(holder.querySelector('[data-relationship="blocks"]')?.textContent).toBe('Waiter task');
  });

  // H1 16.11 (live board): «блокирует: M04 M04 — приёмка этапа» — the tag was
  // prefixed to a title that already starts with it. vk11: canvas «↱ M04 приёмка».
  it('a blocks chip names the waiter by its short label («M04 приёмка»)', () => {
    const holder = bead('dw-h', 'open', { title: 'Holder task', labels: ['milestone:M04'] });
    const gate = bead('dw-g', 'open', {
      title: 'M04 — приёмка этапа',
      labels: ['milestone:M04'],
      is_blocked: true,
      dependencies: [{ issue_id: 'dw-g', depends_on_id: 'dw-h', type: 'blocks' }],
    });
    renderBoard([holder, gate], { nowMs: NOW });
    const card = screen.getByText('Holder task').closest('article') as HTMLElement;
    const badge = card.querySelector('[data-relationship="blocks"]') as HTMLElement;
    expect(badge.textContent).toBe('M04 приёмка');
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

  it('a 150-character title stays on one line with an ellipsis (canvas Cards)', () => {
    const long = 'Д'.repeat(150);
    renderBoard([bead('dw-long', 'open', { title: long })], { nowMs: NOW });
    expect(screen.getByText(long).className).toContain('truncate');
  });

  it('the top line is the short label, never the bead id; the title drops it', () => {
    renderBoard(
      [
        bead('dw-eba63b7db1e9a14e.2', 'open', {
          title: 'M03 #2 / Task 6: допуск, enqueue и claim по собственному ящику пользователя',
          labels: ['milestone:M03'],
        }),
        bead('dw-1baxx4', 'open', { title: 'Repair PR #475: CI красный' }),
      ],
      { nowMs: NOW },
    );
    const card = screen.getByText('Допуск, enqueue и claim по собственному ящику пользователя').closest(
      'article',
    ) as HTMLElement;
    expect(card.querySelector('[data-card-label]')?.textContent).toBe('M03 #2');
    expect(card.textContent).not.toContain('dw-eba63b7db1e9a14e.2');
    const bare = screen.getByText('Repair PR #475: CI красный').closest('article') as HTMLElement;
    expect(bare.querySelector('[data-card-label]')).toBeNull();
    expect(bare.textContent).not.toContain('dw-1baxx4');
  });

  it('a card under an epic is labelled by the epic («Один тип») and carries its dot chip', () => {
    const epic = bead('dw-mqfcx', 'open', { title: 'Один тип пользователя', issue_type: 'epic' });
    const model = buildBoardModel(boardData([LIVE_MQFCX13, LIVE_7LPZG7]), [], {
      project: ALL_PROJECTS,
      search: '',
      showTests: false,
    });
    const card = Object.values(model.columns)
      .flat()
      .find((c) => c.node.bead.id === 'dw-mqfcx.13');
    if (card === undefined) throw new Error('no dw-mqfcx.13 card');
    render(
      <MemoryRouter>
        <KanbanCard
          card={card}
          nowMs={NOW}
          selected={false}
          onSelect={vi.fn()}
          beadById={(id) => (id === epic.id ? epic : undefined)}
        />
      </MemoryRouter>,
    );
    const article = document.querySelector('article[data-bead-id="dw-mqfcx.13"]') as HTMLElement;
    expect(article.querySelector('[data-card-label]')?.textContent).toBe('Один тип');
    expect(within(article).getByText(/^Миграция 0425/, { selector: 'button span' })).toBeTruthy();
    expect(within(article).getByText('Один тип пользователя')).toBeTruthy();
  });

  it('the assignee avatar: «А» for the owner, blue «И» for the executor at work', () => {
    renderBoard(
      [
        bead('dw-own', 'open', { title: 'mine', assignee: 'TheDeveloperTom' }),
        bead('dw-run', 'in_progress', { title: 'running', assignee: 'devwork/worker' }),
      ],
      { nowMs: NOW, sessions: [{ id: 's1', session_name: 'devwork/worker', state: 'active' }] },
    );
    const mine = screen.getByText('mine').closest('article') as HTMLElement;
    expect(within(mine).getByRole('img', { name: 'Исполнитель: ты' }).textContent).toBe('А');
    const run = screen.getByText('running').closest('article') as HTMLElement;
    const executor = within(run).getByRole('img', { name: 'Исполнитель' });
    expect(executor.textContent).toBe('И');
    expect(executor.className).toContain('bg-[#1D5BD6]');
  });

  // Fix I2 (REVIEW 16.11): the avatar reads bead.assignee, not the stage.
  it('the avatar is the real assignee: owner «А», agent «И», Richard «Р», none when unassigned', () => {
    renderBoard(
      [
        bead('dw-none', 'open', { title: 'nobody' }),
        bead('dw-me', 'open', { title: 'owner task', assignee: 'TheDeveloperTom' }),
        bead('dw-ag', 'open', { title: 'agent task', assignee: 'gcg-session-9570720d6480982c' }),
        bead('dw-ri', 'open', { title: 'richard task', assignee: 'RicciRi' }),
      ],
      { nowMs: NOW },
    );
    const card = (title: string) => screen.getByText(title).closest('article') as HTMLElement;
    expect(card('nobody').querySelector('[data-avatar]')).toBeNull();
    expect(within(card('owner task')).getByRole('img', { name: 'Исполнитель: ты' }).textContent).toBe('А');
    expect(within(card('agent task')).getByRole('img', { name: 'Исполнитель' }).textContent).toBe('И');
    const richard = within(card('richard task')).getByRole('img', { name: 'Исполнитель: Ричард' });
    expect(richard.textContent).toBe('Р');
    expect(richard.getAttribute('data-avatar')).toBe('peer');
  });

  it('a selected card keeps its background and gets the brand border (canvas Main)', () => {
    renderBoard([bead('dw-sel', 'open', { title: 'chosen' })], { nowMs: NOW, selectedId: 'dw-sel' });
    const card = screen.getByText('chosen').closest('article') as HTMLElement;
    expect(card.className).toContain('border-vk-brand');
    expect(card.className).toContain('bg-vk-bg-primary');
    expect(card.className).not.toContain('ring-2');
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
    expect(screen.getAllByText(/миграция 0425/i, { selector: 'button span' })[0]).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Ревью/ }).getAttribute('aria-pressed')).toBe('true');
  });

  // vk11: Phone-Board.dc.html chip row — 44 px chips, gap 6, padding 8 16, 3 px radius, sel border.
  it('column chips match the canvas', () => {
    renderPhone([bead('dw-wait', 'open', { title: 'waiting one' })]);
    const group = screen.getByRole('group', { name: 'Колонки доски' });
    expect(group.className).toContain('gap-1.5');
    expect(group.className).toContain('py-2');
    expect(group.className).toContain('border-b');
    const chip = screen.getByRole('button', { name: /^Ждёт/ });
    expect(chip.className).toContain('h-11');
    expect(chip.className).toContain('rounded-[3px]');
    expect(chip.className).toContain('border-vk-brand');
  });

  it('phone cards carry no project tag (vk11: canvas has none)', () => {
    const model = buildBoardModel(
      boardData([bead('dw-a', 'open', { title: 'rig card' }), bead('gc-b', 'open', { title: 'city card' })]),
      [{ name: 'devwork', prefix: 'dw' }],
      { project: ALL_PROJECTS, search: '', showTests: false },
    );
    render(
      <MemoryRouter>
        <PhoneBoard model={model} nowMs={NOW} selectedId={null} onSelect={vi.fn()} />
      </MemoryRouter>,
    );
    const rig = screen.getByText('rig card').closest('article') as HTMLElement;
    expect(within(rig).queryByText('Продукт devwork')).toBeNull();
    const city = screen.getByText('city card').closest('article') as HTMLElement;
    expect(within(city).queryByText('Город (служебное)')).toBeNull();
  });

  it('an empty model renders without throwing', () => {
    renderPhone([]);
    expect(screen.getByRole('button', { name: /^Ждёт/ })).toBeTruthy();
    expect(screen.getByText('Здесь пусто')).toBeTruthy();
  });
});
