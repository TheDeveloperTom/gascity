import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import type { AttentionContributor, AttentionItem, OwnerReadiness } from '../attention/compose';
import { AttentionProvider } from '../attention/context';
import { invalidate } from '../api/cache';
import { setLocale } from '../i18n';
import type { RunSummarySubscription } from '../runs/runSummarySubscription';
import { CockpitHomePage } from './CockpitHome';

const mocks = vi.hoisted(() => ({
  cityUsage: vi.fn(),
  cityStatus: vi.fn(),
  runCensus: vi.fn(),
  listSessions: vi.fn(),
}));

vi.mock('../supervisor/client', () => ({
  SUPERVISOR_REQUEST_TIMEOUT_MS: 60_000,
  supervisorApi: () => ({
    cityUsage: mocks.cityUsage,
    cityStatus: mocks.cityStatus,
    runCensus: mocks.runCensus,
    listSessions: mocks.listSessions,
  }),
}));

vi.mock('../runs/runSummarySubscription', () => ({
  useRunSummary: () =>
    ({
      loading: false,
      error: null,
      refresh: vi.fn(),
      sseState: 'open',
      source: undefined,
    }) as unknown as RunSummarySubscription,
}));

function contributor(items: readonly AttentionItem[]): AttentionContributor {
  return { id: 'seed', domain: 'beads', getItems: () => items };
}

function cityItem(i: number): AttentionItem {
  return { id: `c${i}`, domain: 'health', severity: 'watch', title: `City thing ${i}` };
}

const ownerItem: AttentionItem = {
  id: 'mail:M-1:unread',
  domain: 'mail',
  severity: 'attention',
  audience: 'owner',
  title: 'Нужен доступ к Supabase',
  href: '/mail?message=M-1',
};

function home(
  items: readonly AttentionItem[] = [],
  readiness: OwnerReadiness = { state: 'ready' },
) {
  const wrap = (children: ReactNode) => (
    <MemoryRouter>
      <AttentionProvider contributors={[contributor(items)]} ownerReadiness={readiness}>
        {children}
      </AttentionProvider>
    </MemoryRouter>
  );
  return render(wrap(<CockpitHomePage />));
}

describe('<CockpitHomePage> owner home', () => {
  beforeEach(() => {
    invalidate('cockpit:');
    mocks.cityUsage.mockReset().mockRejectedValue(new Error('down'));
    mocks.runCensus.mockReset().mockRejectedValue(new Error('down'));
    mocks.listSessions.mockReset().mockRejectedValue(new Error('down'));
    mocks.cityStatus.mockReset().mockResolvedValue({
      name: 'test-city',
      path: '/tmp/test-city',
      agent_count: 15,
      rig_count: 1,
      running: 2,
      suspended: false,
      uptime_sec: 10,
      agents: { total: 15, running: 2, suspended: 0, quarantined: 0 },
      rigs: { total: 1, suspended: 0 },
      work: { open: 3, ready: 1, in_progress: 1 },
      mail: { total: 2, unread: 0 },
      store_health: {
        live_rows: 10,
        path: '/tmp/store',
        ratio_mb_per_row: 0.1,
        size_bytes: 10,
        threshold_mb_per_row: 1,
        warning: false,
      },
    });
  });

  afterEach(() => {
    cleanup();
    setLocale('en');
  });

  it('order is plate, tasks, city, usage', () => {
    const { container } = home();
    const order = Array.from(
      container.querySelectorAll('h2, details > summary'),
    )
      .filter((el) => el.tagName === 'SUMMARY' || el.closest('details') === null)
      .map((el) => el.textContent);
    expect(order).toEqual([
      'Nothing waits for you right now.',
      'What is going on',
      'City',
      'Usage and load',
    ]);
  });

  it('usage details closed by default and holds dial-grid', () => {
    home();
    const details = screen.getByText('Usage and load').closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(within(details).getByTestId('dial-grid')).toBeTruthy();
    expect(within(details).getByRole('button', { name: 'Pause updates' })).toBeTruthy();
    expect(within(details).getByTestId('last24h-grid')).toBeTruthy();
  });

  it('no synopsis line', () => {
    const { container } = home();
    expect(container.textContent).not.toContain('active sessions ·');
    expect(container.textContent).not.toContain('tokens today');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Home');
  });

  it('ru renders Главная and the plate sentence', () => {
    setLocale('ru');
    home();
    expect(screen.getByRole('heading', { level: 1, name: 'Главная' })).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Сейчас вас ничего не ждёт' }),
    ).toBeTruthy();
    expect(screen.getByText('Расход и нагрузка')).toBeTruthy();
  });

  it('only owner items reach the plate', async () => {
    setLocale('ru');
    home([ownerItem, ...Array.from({ length: 40 }, (_, i) => cityItem(i))]);
    expect(screen.getByRole('heading', { level: 2, name: 'Вас ждёт 1 дело' })).toBeTruthy();
    const problems = screen.getByText('Неполадки', { selector: 'dt' })
      .nextElementSibling as HTMLElement;
    expect(problems.querySelector('[data-count]')?.textContent).toBe('40');
    const agents = screen.getByText('Агенты', { selector: 'dt' }).nextElementSibling as HTMLElement;
    expect(await within(agents).findByText('2 из 15 работают')).toBeTruthy();
  });

  it('a lamp that is not healthy becomes a city problem', async () => {
    const status = await mocks.cityStatus();
    mocks.cityStatus.mockResolvedValue({
      ...status,
      store_health: { ...status.store_health, last_gc_status: 'failed' },
    });
    home();
    expect(await screen.findByText('Task store maintenance failed')).toBeTruthy();
  });

  it('plate stays loading while the owner reads are pending', () => {
    home([], { state: 'loading' });
    expect(screen.queryByText(/Nothing waits/)).toBeNull();
    expect(screen.getByText('Checking whether anything waits for you…')).toBeTruthy();
  });
});
