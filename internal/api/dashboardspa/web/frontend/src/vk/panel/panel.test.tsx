import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { BeadDetailModal } from '../../components/BeadDetailModal';
import { useAgentNow } from '../../hooks/useAgentNow';
import { useBeadDetail } from '../../hooks/useBeadDetail';
import { useBoardData } from '../../hooks/useBoardData';
import { setLocale } from '../../i18n';
import { transitiveWaiters } from '../../lib/holds';
import { openExternal } from '../../lib/openExternal';
import type { SupervisorBead } from '../../supervisor/beadReads';

vi.mock('../../hooks/useBeadDetail', () => ({ useBeadDetail: vi.fn() }));
vi.mock('../../hooks/useEntityLinks', () => ({
  useEntityLinks: vi.fn(() => ({ view: null, loading: false, error: null })),
}));
vi.mock('../../hooks/useBoardData', () => ({ useBoardData: vi.fn() }));
vi.mock('../../hooks/useAgentNow', () => ({ useAgentNow: vi.fn(() => new Map()) }));
vi.mock('../../lib/holds', () => ({ transitiveWaiters: vi.fn(() => []) }));
vi.mock('../../lib/openExternal', () => ({ openExternal: vi.fn() }));
// owner 16.11: «Обсудить» opens the owner's Mayor channel (lib/mayorLink)
vi.mock('../../lib/mayorLink', () => ({
  mayorChannelUrl: vi.fn(() => 'https://discord.com/channels/1/2'),
}));

import { DISPATCH_CARD } from './dispatchCardFixture';

const mockDetail = useBeadDetail as unknown as Mock;
const mockBoard = useBoardData as unknown as Mock;
const mockAgentNow = useAgentNow as unknown as Mock;
const mockHolds = transitiveWaiters as unknown as Mock;
const mockOpen = openExternal as unknown as Mock;

const CHAT = 'https://discord.com/channels/1/2/3';

function bead(over: Partial<SupervisorBead> & { id: string }): SupervisorBead {
  return {
    title: `Задача ${over.id}`,
    status: 'open',
    issue_type: 'task',
    priority: 2,
    created_at: '2026-11-15T10:00:00Z',
    labels: [],
    ...over,
  } as SupervisorBead;
}

const CHOICES = [
  { label: 'Сегодня в 18:00', then: 'Перенос и миграция 0424 сегодня вечером' },
  { label: 'Завтра в 10:00', then: 'Перенос утром, 22 задачи подождут ещё ночь' },
  { label: 'Другое время', then: 'Мэр спросит, какое время тебе удобно' },
];

const question = bead({
  id: 'gc-q',
  title: 'Окно переноса ящика — ответ владельца',
  description: 'Подключённый Gmail перейдёт на основной аккаунт.',
  labels: ['needs/operator', 'milestone:M03'],
  metadata: {
    'decision.question_id': 'q-1',
    'decision.decide': 'Когда окно для переноса ящика на основной аккаунт?',
    'decision.why': 'Только ты можешь войти под основным аккаунтом.',
    'decision.choices_json': JSON.stringify(CHOICES),
    'decision.chat_url': CHAT,
  },
});

const unlinked = bead({
  id: 'gc-u',
  labels: ['needs/operator'],
  metadata: { 'decision.question_id': 'q-2' },
});

const plain = bead({ id: 'gc-p', title: 'Обычная задача' });

function show(b: SupervisorBead, items: readonly SupervisorBead[] = [b], onClose = () => {}) {
  mockDetail.mockReturnValue({ bead: b, loading: false, error: null, notFound: false, now: 0 });
  mockBoard.mockReturnValue({ data: { items }, sessions: [], rigs: [], loading: false, error: null });
  return render(<BeadDetailModal open onClose={onClose} beadId={b.id} initialBead={b} />);
}

beforeEach(() => {
  setLocale('ru');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mockAgentNow.mockReturnValue(new Map());
  mockHolds.mockReturnValue([]);
});

describe('task drawer', () => {
  it('is a right-side dialog, not centred, and Esc closes it', () => {
    const onClose = vi.fn();
    show(plain, [plain], onClose);
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('md:right-0');
    expect(dialog.className).not.toContain('items-center');
    expect(dialog.parentElement?.className ?? '').not.toContain('justify-center');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a plain task shows «Обсудить с Мэром», no question block and no empty chips row', () => {
    show(plain);
    expect(screen.queryByTestId('task-chips')).toBeNull();
    expect(screen.getByRole('button', { name: 'Обсудить с Мэром' })).toBeTruthy();
    expect(screen.queryByTestId('question-card')).toBeNull();
    expect(screen.queryByText('Ответить в Discord')).toBeNull();
  });

  it('an unlinked question shows no question block (no dead link) but still «Обсудить с Мэром»', () => {
    show(unlinked);
    expect(screen.queryByTestId('question-card')).toBeNull();
    expect(screen.queryByText('Ответить в Discord')).toBeNull();
    expect(screen.getByRole('button', { name: 'Обсудить с Мэром' })).toBeTruthy();
  });

  it('shows no «Путь задачи» and no «раунд»', () => {
    show(question);
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('Путь задачи');
    expect(text).not.toMatch(/раунд/i);
  });

  // vk-1to1 (canvas Main «Открытая задача»): crumb «M04 #3 / PR #580» with
  // copy-link, then «···» and close; status row; chips row; one discuss link.
  const canvasTask = bead({
    id: 'dw-1baxx4',
    title: 'Сделать invalidation при изменении вакансии/профиля/предпочтений',
    status: 'in_progress',
    assignee: 'Исполнитель',
    parent: 'dw-epic',
    labels: ['milestone:M04', 'kind:stage'],
    description: 'Пересчитывать оценку.\n\n- вакансия\n- профиль',
    metadata: { 'devwork.step': '3', 'devwork.pr_number': '580', 'devwork.pr_url': 'https://github.com/o/r/pull/580' },
  });

  it('header: crumb «M04 #3 / PR #580» (not the raw id), copy-link, «Ещё», «Закрыть»', () => {
    show(canvasTask);
    const crumb = screen.getByTestId('task-crumb');
    expect(crumb.textContent).toBe('M04 #3/PR #580');
    expect(crumb.textContent).not.toContain('dw-1baxx4');
    expect(crumb.className).toContain('font-vk-mono');
    expect(crumb.className).toContain('text-[15px]');
    expect(within(crumb).getByRole('button', { name: 'Скопировать ссылку' })).toBeTruthy();
    const header = screen.getByTestId('task-drawer-header');
    expect(header.className).toContain('min-h-[44px]');
    expect(within(header).getByRole('button', { name: 'Ещё' })).toBeTruthy();
    expect(within(header).getByRole('button', { name: 'Закрыть' })).toBeTruthy();
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Открытая задача');
  });

  it('the crumb takes «#N» from a live title «M04 #1 — …» when no step is stored', () => {
    show(bead({ id: 'dw-a4e4', title: 'M04 #1 — Перенести sync', labels: ['milestone:M04'] }));
    expect(screen.getByTestId('task-crumb').textContent).toBe('M04 #1');
  });

  it('status row «В работе», «И Исполнитель», «Подзадача M04»; chips M04, «Пакет этапа», #580', () => {
    show(canvasTask);
    const row = screen.getByTestId('task-status-row');
    expect(row.textContent).toBe('В работеИИсполнительПодзадача M04');
    expect((within(row).getByTestId('status-dot') as HTMLElement).style.background).toBe('rgb(245, 158, 11)');
    const chips = screen.getByTestId('task-chips');
    expect(chips.textContent).toBe('M04Пакет этапа#580');
    expect(within(chips).getByText('#580').getAttribute('href')).toBe('https://github.com/o/r/pull/580');
  });

  it('title, then ONE «Обсудить с Мэром», then the description as markdown with its list', () => {
    show(canvasTask);
    const h = screen.getByRole('heading', { level: 2 });
    expect(h.className).toContain('text-xl');
    expect(h.className).toContain('font-medium');
    expect(screen.getAllByRole('button', { name: 'Обсудить с Мэром' })).toHaveLength(1);
    const md = screen.getByTestId('task-description');
    expect(md.querySelectorAll('li')).toHaveLength(2);
    expect(md.querySelector('p')?.textContent).toBe('Пересчитывать оценку.');
    expect(screen.getByRole('dialog').textContent).not.toContain('Подробности');
  });

  it('bottom: «Сообщение Мэру про эту задачу», the canvas placeholder, «Уйдёт Мэру в Discord», «Обсудить в Discord»', () => {
    show(canvasTask);
    const box = screen.getByTestId('mayor-message');
    const area = within(box).getByLabelText('Сообщение Мэру про эту задачу');
    expect(area.getAttribute('placeholder')).toBe('Например: «почему стоит?» или «отложи до завтра»');
    expect(within(box).getByText('Уйдёт Мэру в Discord')).toBeTruthy();
    const send = within(box).getByRole('button', { name: 'Обсудить в Discord' });
    expect(send.className).toContain('bg-[#AC5111]');
    fireEvent.change(area, { target: { value: 'почему стоит?' } });
    fireEvent.click(send);
    expect(mockOpen).toHaveBeenCalledWith('https://discord.com/channels/1/2');
    expect((area as HTMLTextAreaElement).value).toBe('');
  });

  it('«Работа агентов 1»: «Исполнитель», #580, «Смотреть, что пишет» only when streamable', () => {
    show(canvasTask);
    const work = screen.getByTestId('agent-work');
    expect(within(work).getByText('Работа агентов')).toBeTruthy();
    expect(within(work).getByText('1')).toBeTruthy();
    expect(within(work).getByText('Исполнитель')).toBeTruthy();
    expect(within(work).getByText('#580')).toBeTruthy();
  });

  it('a 150-character title without spaces wraps', () => {
    const long = bead({ id: 'gc-l', title: 'Ж'.repeat(150) });
    show(long);
    const heading = screen.getByRole('heading', { name: 'Ж'.repeat(150) });
    expect(heading.className).toContain('[overflow-wrap:anywhere]');
  });
});

describe('question card', () => {
  it('is compact and built from the question’s own data', () => {
    show(question);
    const card = screen.getByTestId('question-card');
    expect(within(card).getByText('Когда окно для переноса ящика на основной аккаунт?')).toBeTruthy();
    expect(within(card).getByText('Что случилось')).toBeTruthy();
    expect(within(card).getByText('Только ты можешь войти под основным аккаунтом.')).toBeTruthy();
    expect(within(card).getByText('Перенос утром, 22 задачи подождут ещё ночь')).toBeTruthy();
    // polish2 16.11 (owner): one Russian primary button, no «Другое — обсудить в Discord».
    expect(within(card).queryByText(/Другое —|Other|discuss/i)).toBeNull();
    // Owner change 15.11: no «Мэр спрашивает», no «Почему нужен ты», no hint line.
    const text = card.textContent ?? '';
    expect(text).not.toContain('Мэр спрашивает');
    expect(text).not.toContain('Почему нужен ты');
    expect(text).not.toContain('сразу уйдёт');
  });

  it('every task, question or not, has «Обсудить с Мэром»', () => {
    show(question);
    expect(screen.getByRole('button', { name: 'Обсудить с Мэром' })).toBeTruthy();
  });

  it('one primary «Ответить в Discord» opens the question message; the choices are read-only (polish2 16.11)', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    show(question);
    const card = screen.getByTestId('question-card');
    const buttons = within(card).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Ответить в Discord']);
    // the options stay visible as text so the owner knows what he will pick
    expect(within(card).getByText('Завтра в 10:00')).toBeTruthy();
    fireEvent.click(buttons[0]!);
    expect(mockOpen).toHaveBeenCalledWith(CHAT);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    expect(screen.getByTestId('question-card')).toBeTruthy();
    expect(screen.queryByText(/отвечено/)).toBeNull();
  });

  it('a legacy question with no choices has the same single button, which opens the message', () => {
    const legacy = bead({
      id: 'gc-legacy',
      labels: ['needs/operator'],
      metadata: { 'decision.question_id': 'q-3', 'decision.chat_url': CHAT },
    });
    show(legacy);
    const card = screen.getByTestId('question-card');
    expect(within(card).getAllByRole('button').map((b) => b.textContent)).toEqual(['Ответить в Discord']);
    fireEvent.click(screen.getByRole('button', { name: 'Ответить в Discord' }));
    expect(mockOpen).toHaveBeenCalledWith(CHAT);
  });

  it('the status reads «Открыта», never a raw key, in Russian and in English', () => {
    show(question);
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Открыта');
    expect(dialog.textContent).not.toMatch(/status\./);
    cleanup();
    setLocale('en');
    show(question);
    expect(screen.getByRole('dialog').textContent).not.toMatch(/status\./);
  });
});

describe('relationships', () => {
  it('lists «блокирует M04 … <title>» and «и ещё 20» for 22 waiters', () => {
    const target = bead({ id: 'gc-t', title: 'Цель' });
    const waiters = Array.from({ length: 22 }, (_, i) =>
      bead({
        id: `gc-w${i}`,
        title: `Ждущая ${i}`,
        labels: ['milestone:M04'],
        needs: ['gc-t'],
      }),
    );
    mockHolds.mockReturnValue(waiters.map((w) => w.id));
    show(target, [target, ...waiters]);
    const section = screen.getByTestId('task-relationships');
    expect(within(section).getAllByText('блокирует')).toHaveLength(2);
    expect(within(section).getAllByText('M04')).toHaveLength(2);
    expect(within(section).getByText('Ждущая 0')).toBeTruthy();
    expect(within(section).getByText('и ещё 20')).toBeTruthy();
    // canvas «Связи 4»: the count of relations, not «держит N»
    expect(within(section).getByText('22')).toBeTruthy();
  });

  // H1 16.11 (live drawer at 390 px): the rows were 32 px tall (tap targets
  // ≥ 44 px on a phone) and read «M04 M04 — приёмка этапа».
  it('rows are 44 px tap targets on a phone and do not repeat a tag the title starts with', () => {
    const target = bead({ id: 'gc-t', title: 'Цель' });
    const gate = bead({ id: 'gc-g', title: 'M04 — приёмка этапа', labels: ['milestone:M04'], needs: ['gc-t'] });
    mockDetail.mockReturnValue({ bead: target, loading: false, error: null, notFound: false, now: 0 });
    mockBoard.mockReturnValue({ data: { items: [target, gate] }, sessions: [], rigs: [], loading: false, error: null });
    render(<BeadDetailModal open onClose={() => {}} beadId="gc-t" initialBead={target} onOpenBead={vi.fn()} />);
    const section = screen.getByTestId('task-relationships');
    const row = within(section).getByRole('button', { name: /приёмка этапа/ });
    expect(row.className.split(/\s+/)).toContain('min-h-11');
    expect(within(section).queryAllByText('M04')).toHaveLength(0);
    expect(row.textContent).toBe('блокируетM04 — приёмка этапа');
  });
});

// polish2 16.11 item 8 (owner screenshots of dw-11d21b41c8f56781): the drawer
// is one screen: title, one meta line, the description once as Markdown, one
// «Связи» section. No «Подробности», no raw `**`/`###`, no English.
describe('the drawer is one screen (item 8)', () => {
  const PARENT = bead({ id: 'dw-eba63b7db1e9a14e', title: 'M03 #2 / Task 6: допуск по собственному ящику' });
  const BLOCKER = bead({ id: 'dw-76d30a7621ef3a49', title: 'm03-d2-provider-binding — привязка провайдера' });
  const items = [DISPATCH_CARD, PARENT, BLOCKER];

  it('renders the description once, as Markdown: bold, a heading, line breaks; no raw markers', () => {
    show(DISPATCH_CARD, items);
    const dialog = screen.getByRole('dialog');
    const text = dialog.textContent ?? '';
    expect(text.split('Что меняем и зачем').length - 1).toBe(1);
    expect(text).not.toContain('**');
    expect(text).not.toContain('###');
    const md = screen.getByTestId('task-description');
    expect(within(md).getAllByText(/:$/, { selector: 'strong' }).length).toBe(6);
    expect(within(md).getByRole('heading', { name: 'Исходные сведения и технические ссылки' })).toBeTruthy();
    // each source line keeps its own line
    expect(md.querySelectorAll('br').length).toBeGreaterThanOrEqual(5);
    // a visible heading and bold (Tailwind preflight resets both)
    expect(md.className).toContain('[&_h3]:font-semibold');
    expect(md.className).toContain('[&_strong]:font-semibold');
  });

  it('has no «Подробности» block and no English section names', () => {
    show(DISPATCH_CARD, items);
    const text = screen.getByRole('dialog').textContent ?? '';
    for (const gone of ['Подробности', 'Details', 'Description', 'Описание', 'Зависимости', 'Dependencies', 'Связанное', 'Related']) {
      expect(text, gone).not.toContain(gone);
    }
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('the status row replaces the meta line: «Открыта», «Задача M03» ... no raw English', () => {
    show(DISPATCH_CARD, items);
    expect(screen.queryByTestId('task-meta')).toBeNull();
    const text = screen.getByTestId('task-status-row').textContent ?? '';
    expect(text).toContain('Открыта');
    expect(text).toContain('M03');
    expect(text).not.toMatch(/\bopen\b|\btask\b/);
    // the description comes after the title, before the relations
    const h = screen.getByRole('heading', { level: 2 });
    const md = screen.getByTestId('task-description');
    const rel = screen.getByTestId('task-relationships');
    expect(h.compareDocumentPosition(md) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(md.compareDocumentPosition(rel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('relations are ONE «Связи» section: waits on, part of', () => {
    show(DISPATCH_CARD, items);
    expect(screen.getAllByRole('heading', { name: 'Связи' })).toHaveLength(1);
    const rel = screen.getByTestId('task-relationships');
    expect(within(rel).getByText('ждёт')).toBeTruthy();
    expect(within(rel).getByText('m03-d2-provider-binding — привязка провайдера')).toBeTruthy();
    expect(within(rel).getByText('часть')).toBeTruthy();
    expect(within(rel).getByText('M03 #2 / Task 6: допуск по собственному ящику')).toBeTruthy();
  });

  // review M-2: «Подробности» used to warn on formula templates; the meta line does now.
  it('a formula template says in the chips row that it is a recipe, not work', () => {
    const recipe = { ...DISPATCH_CARD, id: 'gc-recipe', metadata: { 'gc.kind': 'run' } };
    show(recipe, [recipe]);
    expect(screen.getByTestId('task-chips').textContent).toContain('Рецепт прогона, а не работа: не закрывай её');
    cleanup();
    show(DISPATCH_CARD, items);
    expect(screen.getByTestId('task-chips').textContent).not.toContain('Рецепт');
  });

  // review M-3: no links at all reads «Связей нет.»
  it('a card with no links says «Связей нет.»', () => {
    const { parent: _parent, ...noParent } = DISPATCH_CARD;
    const lone = { ...noParent, id: 'gc-lone', dependencies: [] };
    show(lone, [lone]);
    expect(within(screen.getByTestId('task-relationships')).getByText('Связей нет.')).toBeTruthy();
  });

  // review M-4: the drawer title is an h2, so description headings start at h3.
  it('description headings sit below the drawer title (no h1/h2 inside)', () => {
    const md = { ...DISPATCH_CARD, id: 'gc-md', description: '# Большой\n\n## Средний\n\nтекст' };
    show(md, [md]);
    const body = screen.getByTestId('task-description');
    expect(body.querySelector('h1, h2')).toBeNull();
    expect(within(body).getByRole('heading', { level: 3, name: 'Большой' })).toBeTruthy();
    expect(within(body).getByRole('heading', { level: 4, name: 'Средний' })).toBeTruthy();
  });

  // 16.11 owner: a one-line description (migrated cards) is no longer one wall of text.
  it('a one-line description renders as paragraphs, bold labels and a numbered list', () => {
    const flat = {
      ...DISPATCH_CARD,
      id: 'gc-flat',
      description:
        'Начать сразу. Основание: замер. Четыре вливания: 1) типы; 2) шарды; 3) прогон. Не входит: удаление тестов.',
    };
    show(flat, [flat]);
    const body = screen.getByTestId('task-description');
    expect(body.querySelectorAll('p').length).toBeGreaterThanOrEqual(3);
    expect(within(body).getByText('Основание:').tagName).toBe('STRONG');
    expect(within(body).getByText('Не входит:').tagName).toBe('STRONG');
    expect(Array.from(body.querySelectorAll('ol > li')).map((li) => li.textContent)).toEqual([
      'типы',
      'шарды',
      'прогон.',
    ]);
  });

  // review M-8: «нужен ты» sits in the meta line, not in the phone's back row.
  it('«нужен ты» is in the chips row, not in the header row', () => {
    show(question);
    expect(within(screen.getByTestId('task-chips')).getByText('нужен ты')).toBeTruthy();
    expect(within(screen.getByTestId('task-drawer-header')).queryByText('нужен ты')).toBeNull();
  });
});
