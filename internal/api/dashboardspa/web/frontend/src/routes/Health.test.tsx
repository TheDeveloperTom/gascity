import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HealthOutputBody, StatusBody } from 'gas-city-dashboard-shared/gc-supervisor';
import type {
  DoltNomsTrend,
  LiveHealth,
  LocalToolVersions,
  RigStoreHealthReport,
} from 'gas-city-dashboard-shared';
import { HealthPage } from './Health';
import { invalidate } from '../api/cache';
import { AttentionProvider } from '../attention/context';
import { createAttentionContributors, type HealthAttentionFacts } from '../attention/registry';
import { collectMissing, resetMissing, setLocale } from '../i18n';
import { resetLiveHistory } from '../lib/hostLive';
import { liveFixture } from '../test/fixtures/liveHealth';

// Owner 16.11: Health answers «что с маком происходит при текущей нагрузке»:
// a one-sentence verdict, realtime charts, who eats the Mac, and the city's
// facts quietly below. Russian, full width.

const mockCityHealth = vi.fn<(cityName: string) => Promise<HealthOutputBody>>();

vi.mock('../supervisor/client', () => ({
  supervisorApiForRequestBudget: vi.fn(() => ({ cityHealth: mockCityHealth })),
}));

let live: LiveHealth = liveFixture();
let status: StatusBody = baseStatus();
let trend: DoltNomsTrend = {
  available: true,
  samples: [],
  source: 'status.store_health.size_bytes',
};

beforeEach(() => {
  invalidate('health');
  resetLiveHistory();
  setLocale('ru');
  resetMissing();
  live = liveFixture({
    processes: {
      status: 'available',
      coverage: 'all_processes',
      total: 640,
      items: [
        { name: 'claude', count: 6, cpu_pct: 140, rss_bytes: 1_800_000_000 },
        { name: 'dolt', count: 3, cpu_pct: 4, rss_bytes: 280_000_000 },
        { name: 'gc', count: 4, cpu_pct: 1, rss_bytes: 900_000_000 },
        { name: 'WindowServer', count: 1, cpu_pct: 12, rss_bytes: 80_000_000 },
      ],
      rest: { count: 626, cpu_pct: 3, rss_bytes: 400_000_000 },
    },
  });
  status = baseStatus();
  trend = { available: true, samples: [], source: 'status.store_health.size_bytes' };
  mockCityHealth.mockReset();
  mockCityHealth.mockResolvedValue({
    status: 'ok',
    city: 'demo',
    version: 'dev',
    uptime_sec: 21_000,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/health/live') return json(live);
      if (url === '/api/health/local-tools') return json(tools());
      if (url === '/api/city/test-city/dolt-noms/trend') return json(trend);
      if (url === '/api/city/test-city/rig-store-health') return json(rigStores());
      if (url === '/api/city/test-city/supervisor-status') {
        return json({ available: true, sampledAt: '2026-11-16T10:00:00Z', status });
      }
      return new Response(JSON.stringify({ error: `unexpected ${url}` }), { status: 404 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setLocale('en');
});

describe('HealthPage', () => {
  it('opens with one Russian sentence about the Mac right now', async () => {
    renderPage();
    const headline = await screen.findByRole('heading', { level: 1 });
    expect(headline.textContent).toContain(
      'Процессор занят на 31\u00a0%; памяти хватает; на диске свободно 40\u00a0ГБ.',
    );
    expect(headline.closest('[data-host-tone]')?.getAttribute('data-host-tone')).toBe('ok');
  });

  it('turns the headline amber when the disk runs low', async () => {
    live = {
      ...live,
      disk: {
        status: 'available',
        value: { total_bytes: 460 * 2 ** 30, free_bytes: 9.3 * 2 ** 30 },
      },
    };
    renderPage();
    const headline = await screen.findByRole('heading', { level: 1 });
    await screen.findByText(/на диске мало места/);
    expect(headline.closest('[data-host-tone]')?.getAttribute('data-host-tone')).toBe('warn');
  });

  it('shows the CPU as busy % and the queue as a multiple of the cores, never above 100 %', async () => {
    live = {
      ...live,
      sampled_at: new Date().toISOString(),
      cpu: {
        cores: 10,
        busy_pct: { status: 'available', value: 100 },
        load: { status: 'available', value: { load_avg_1: 36, load_avg_5: 30, load_avg_15: 20 } },
      },
    };
    renderPage();
    const cpu = await screen.findByRole('region', { name: 'Процессор' });
    await within(cpu).findByText(/^100\s%$/, { selector: 'p' });
    expect(
      within(cpu).getByText('очередь задач: в 3,6 раза больше, чем ядер (36 на 10)'),
    ).toBeTruthy();
    const headline = screen.getByRole('heading', { level: 1 });
    expect(headline.textContent).toContain('задачи ждут в очереди (в 3,6 раза больше ядер)');
    // Coordinator 16.11: no CPU figure above 100 % anywhere on the page.
    // Each text node on its own: textContent glues «×6» and «14 %» together.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const texts: string[] = [];
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode())
      texts.push(n.textContent ?? '');
    expect(texts.filter((text) => /\d\s?%/.test(text))).not.toHaveLength(0);
    expect(texts.join('\n')).not.toMatch(/(1(0[1-9]|[1-9][0-9])|[2-9][0-9]{2}|[0-9]{4,})\s?%/);
    // The CPU chart reads busy % on a 0–100 axis.
    expect(screen.getByRole('img', { name: /^Процессор: занят 100\s%$/ })).toBeTruthy();
  });

  it('draws the CPU, memory and disk charts', async () => {
    renderPage();
    expect(await screen.findByRole('img', { name: /^Процессор/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: /^Память/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: /^Диск/ })).toBeTruthy();
  });

  it('shows who eats the Mac, grouped, by process name only', async () => {
    renderPage();
    const region = await screen.findByRole('region', { name: 'Кто ест Мак' });
    expect(await within(region).findAllByText('Агенты')).not.toHaveLength(0);
    expect(within(region).getAllByText('claude').length).toBeGreaterThan(0);
    expect(within(region).getAllByText('Хранилища (dolt, bd)').length).toBeGreaterThan(0);
  });

  // Review I-1: busy 100 % on 10 cores, the named processes explain 16 %.
  it('shows the CPU the process list cannot explain as its own row', async () => {
    live = { ...live, cpu: { ...live.cpu, busy_pct: { status: 'available', value: 100 } } };
    renderPage();
    const region = await screen.findByRole('region', { name: 'Кто ест Мак' });
    const row = (await within(region).findByText('Система и прочее (не видно по процессам)')).closest('li');
    expect(row?.textContent).toContain('84\u00a0%');
    expect(row?.textContent).toContain('ядро macOS и процессы, мелькнувшие между замерами');
  });

  it('says when only the owner’s own processes are readable', async () => {
    live = {
      ...live,
      cpu: { ...live.cpu, busy_pct: { status: 'available', value: 100 } },
      processes: { ...live.processes, coverage: 'own_processes' },
    };
    renderPage();
    expect(
      await screen.findByText(/процессы системы и других пользователей без прав администратора не видны/),
    ).toBeTruthy();
  });

  it('says plainly when the process list is only visible on this Mac', async () => {
    live = {
      ...live,
      processes: {
        status: 'unavailable',
        reason: 'not_loopback',
        coverage: 'none',
        total: 0,
        items: [],
        rest: { count: 0, cpu_pct: 0, rss_bytes: 0 },
      },
    };
    renderPage();
    expect(await screen.findByText(/Список процессов виден только на самом Маке/)).toBeTruthy();
  });

  it('flags a bloated city store as one plain advisory line and changes nothing', async () => {
    status = baseStatus({
      size_bytes: 939_298_155,
      live_rows: 16,
      ratio_mb_per_row: 58.7,
      warning: false,
    });
    renderPage();
    expect(
      await screen.findByText(
        /^База города раздута: 896\sМБ на 16 записей — можно сжать \(нужно твоё «да»\)\.$/,
      ),
    ).toBeTruthy();
  });

  it('shows no advisory while the store is within its MB-per-row threshold', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1 });
    await screen.findAllByText('dev');
    expect(screen.queryByText(/База города раздута/)).toBeNull();
  });

  it('keeps a missing store trend as a quiet note, not a problem', async () => {
    trend = { available: false, samples: [], reason: 'store_health_absent' };
    renderPage({ trend });
    expect(await screen.findByText(/Тренд размера базы не ведётся/)).toBeTruthy();
    expect(screen.queryByText(/Нет тренда хранилища/)).toBeNull();
  });

  it('keeps supervisor, tool versions and store health below, in Russian', async () => {
    renderPage();
    const facts = await screen.findByRole('region', { name: 'Город' });
    expect(await within(facts).findByText('работает 5 ч 50 мин')).toBeTruthy();
    expect(within(facts).getByText('1.3.2')).toBeTruthy();
    expect(within(facts).getByText('devwork')).toBeTruthy();
    expect(screen.queryByText('Admin process')).toBeNull();
    expect(collectMissing()).toEqual([]);
  });
});

function renderPage(facts?: HealthAttentionFacts) {
  const contributors = createAttentionContributors(facts === undefined ? {} : { health: facts });
  return render(
    <MemoryRouter initialEntries={['/health']}>
      <AttentionProvider contributors={contributors}>
        <HealthPage />
      </AttentionProvider>
    </MemoryRouter>,
  );
}

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function tools(): LocalToolVersions {
  return {
    dolt: { status: 'available', version: '1.81.0', source: '/opt/homebrew/bin/dolt' },
    beads: { status: 'available', version: '1.3.2', source: '/usr/local/bin/bd' },
    gc: { status: 'available', version: 'dev', source: '/Users/me/go/bin/gc' },
  };
}

function rigStores(): RigStoreHealthReport {
  return {
    available: true,
    sampledAt: '2026-11-16T10:00:00Z',
    rigs: [
      {
        rig: 'devwork',
        beadsPath: '/srv/devwork/.beads',
        rollup: 'ok',
        reachable: true,
        doltEndpoint: null,
        doltConnected: true,
        problems: [],
      },
    ],
  };
}

function baseStatus(store: Partial<NonNullable<StatusBody['store_health']>> = {}): StatusBody {
  return {
    agent_count: 15,
    agents: { quarantined: 0, running: 2, suspended: 0, total: 15 },
    mail: { total: 0, unread: 0 },
    name: 'test-city',
    path: '/srv/test-city',
    rig_count: 1,
    rigs: { suspended: 0, total: 1 },
    running: 2,
    store_health: {
      live_rows: 2000,
      path: '/srv/test-city/.beads/dolt',
      ratio_mb_per_row: 0.5,
      rows_measured: true,
      size_bytes: 1_000_000_000,
      threshold_mb_per_row: 1,
      warning: false,
      ...store,
    },
    suspended: false,
    uptime_sec: 21_000,
    version: 'dev',
    work: { open: 149, ready: 96, in_progress: 1 },
  };
}
