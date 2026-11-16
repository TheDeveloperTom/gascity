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

  it('a plain task shows «Обсудить с Мэром» and no question block', () => {
    show(plain);
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

  it('the phone button bar is sticky at the bottom', () => {
    show(plain);
    const bar = screen.getByTestId('task-drawer-actions');
    expect(bar.className).toContain('sticky');
    expect(bar.className).toContain('bottom-0');
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
    expect(within(section).getByText('держит 22')).toBeTruthy();
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

  it('one meta line under the title: «Открыта», the stage, «Исполнитель: нет», the date, the labels', () => {
    show(DISPATCH_CARD, items);
    const meta = screen.getByTestId('task-meta');
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.nextElementSibling).toBe(meta);
    const text = meta.textContent ?? '';
    expect(text).toContain('Открыта');
    expect(text).toContain('M03');
    expect(text).toContain('Исполнитель: нет');
    expect(text).toMatch(/создана 28 окт/);
    expect(text).not.toMatch(/\bopen\b|\btask\b|·$/);
    // the description comes right after the meta line, before the relations
    const md = screen.getByTestId('task-description');
    const rel = screen.getByTestId('task-relationships');
    expect(meta.compareDocumentPosition(md) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
});
