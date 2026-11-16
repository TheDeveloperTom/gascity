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
    expect(
      within(card).getByRole('button', { name: 'Другое — обсудить в Discord' }),
    ).toBeTruthy();
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

  it('a choice opens the Mayor’s Discord message and sends nothing (owner 16.11: answers live in Discord)', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    show(question);
    const choices = within(screen.getByTestId('question-choices')).getAllByRole('button');
    expect(choices).toHaveLength(3);
    fireEvent.click(choices[1]!);
    expect(mockOpen).toHaveBeenCalledWith(CHAT);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    // Nothing was sent from here: the question stays open, no «отвечено» claim.
    expect(screen.getByTestId('question-card')).toBeTruthy();
    expect(screen.queryByText(/отвечено/)).toBeNull();
  });


  it('a legacy question with no choices offers «Ответить в Discord», which opens the message', () => {
    const legacy = bead({
      id: 'gc-legacy',
      labels: ['needs/operator'],
      metadata: { 'decision.question_id': 'q-3', 'decision.chat_url': CHAT },
    });
    show(legacy);
    fireEvent.click(screen.getByRole('button', { name: 'Ответить в Discord' }));
    expect(mockOpen).toHaveBeenCalledWith(CHAT);
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

