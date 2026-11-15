import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import type { AttentionContributor, AttentionItem, OwnerReadiness } from '../attention/compose';
import { composeAttention } from '../attention/compose';
import { AttentionProvider } from '../attention/context';
import { createAttentionContributors } from '../attention/registry';
import { invalidate } from '../api/cache';
import { setLocale } from '../i18n';
import type { RunSummarySubscription } from '../runs/runSummarySubscription';
import { needsFromBoard, type NeedsModel } from '../lib/needsFromMe';
import { NOW_MS, needsBoard } from '../vk/needs/needsFixture';
import { CockpitHomePage } from './CockpitHome';

const EMPTY_NEEDS: NeedsModel = { state: 'ready', needs: [], stalls: [], quiet: [], count: 0 };
const needsModel = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('../lib/needsFromMe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/needsFromMe')>()),
  useNeedsModel: () => needsModel.current,
}));

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
    needsModel.current = EMPTY_NEEDS;
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

  it('order is needs, at work, quiet, city, usage', () => {
    const { container } = home();
    const order = Array.from(container.querySelectorAll('h2, details > summary'))
      .filter((el) => el.tagName === 'SUMMARY' || el.closest('details') === null)
      .map((el) => el.textContent?.trim());
    expect(order).toEqual(['Needs from me 0', 'At work', 'Quiet', 'City', 'Usage and load']);
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
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Needs from me');
  });

  it('ru renders «Нужно от меня» and the all-clear', () => {
    setLocale('ru');
    home();
    expect(screen.getByRole('heading', { level: 1, name: 'Нужно от меня' })).toBeTruthy();
    expect(screen.getByText('Сейчас от тебя ничего не нужно.')).toBeTruthy();
    expect(screen.getByText('Расход и нагрузка')).toBeTruthy();
  });

  it('the needs shelf counts the needs model; city items stay in the city strip', async () => {
    setLocale('ru');
    // Questions 2 + the mail ask + the owner-marked stall; the 40 city items stay out.
    needsModel.current = needsFromBoard(needsBoard(), [], [], NOW_MS, false, [ownerItem]);
    home([ownerItem, ...Array.from({ length: 40 }, (_, i) => cityItem(i))]);
    expect(screen.getByRole('button', { name: 'Нужно от меня 4' })).toBeTruthy();
    const problems = screen.getByText('Неполадки', { selector: 'dt' })
      .nextElementSibling as HTMLElement;
    expect(problems.querySelector('[data-count]')?.textContent).toBe('40');
    const agents = screen.getByText('Агенты', { selector: 'dt' }).nextElementSibling as HTMLElement;
    expect(await within(agents).findByText('2 из 15 работают')).toBeTruthy();
  });

  // Review I-4: Home's «Неполадки» is the attention model's city slice, the
  // same number the rail's Health pill (city.total) and Health's list read.
  it('lamp problems come from the city slice, so Home counts what the model counts', async () => {
    const status = await mocks.cityStatus();
    const contributors = createAttentionContributors({
      liveFeed: 'closed',
      health: {
        cityStatus: {
          ...status,
          store_health: { ...status.store_health, last_gc_status: 'failed' },
        },
      },
    });
    const model = composeAttention(contributors);
    render(
      <MemoryRouter>
        <AttentionProvider contributors={contributors}>
          <CockpitHomePage />
        </AttentionProvider>
      </MemoryRouter>,
    );
    const problems = screen.getByText('Problems', { selector: 'dt' })
      .nextElementSibling as HTMLElement;
    expect(problems.querySelector('[data-count]')?.textContent).toBe(String(model.city.total));
    expect(model.city.total).toBe(2);
    expect(within(problems).getByText('Task store maintenance failed')).toBeTruthy();
    expect(within(problems).getByText('Live updates are disconnected')).toBeTruthy();
  });

  it('Home derives no lamp problem of its own', async () => {
    const status = await mocks.cityStatus();
    mocks.cityStatus.mockResolvedValue({
      ...status,
      store_health: { ...status.store_health, last_gc_status: 'failed' },
    });
    home();
    expect(await screen.findByText('2 of 15 working')).toBeTruthy();
    expect(screen.queryByText('Task store maintenance failed')).toBeNull();
  });

  it('needs stay loading while the board read is pending', () => {
    needsModel.current = { state: 'loading', needs: [], stalls: [], quiet: [], count: 0 };
    home([], { state: 'loading' });
    expect(screen.queryByText(/Nothing needs you/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Needs from me' })).toBeTruthy();
    expect(screen.getAllByText('Reading the board…').length).toBeGreaterThan(0);
  });
});
