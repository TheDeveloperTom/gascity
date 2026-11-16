import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttentionProvider } from '../../attention/context';
import { Header } from '../../components/Header';
import { Layout } from '../../components/Layout';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { ViewingAsProvider } from '../../contexts/ViewingAsContext';
import { setLocale } from '../../i18n';
import { BottomTabs } from './BottomTabs';
import { ProjectRail } from './ProjectRail';
import { TopNav } from './TopNav';

// vk lane 5: the VK shell. The top bar replaces the left rail (ruling 4);
// on phones a fixed bottom bar carries three tabs.

const mocks = vi.hoisted(() => ({
  count: 0,
  openCommandBar: vi.fn(),
  hardNavigate: vi.fn(),
}));

vi.mock('../../lib/needsFromMe', () => ({ useNeedsFromMeCount: () => mocks.count }));
vi.mock('../../lib/commandBar', () => ({
  openCommandBar: mocks.openCommandBar,
  useCommandBarOpen: () => [false, () => {}],
}));
vi.mock('../../lib/navigation', () => ({ hardNavigate: mocks.hardNavigate }));

vi.mock('../../api/cityBase', async (orig) => ({
  ...(await orig<typeof import('../../api/cityBase')>()),
  getActiveCity: () => 'a',
}));

vi.mock('../../api/client', () => ({
  api: {
    config: vi.fn(async () => ({
      cityName: 'a',
      defaultView: null,
      enabledModules: [],
      readOnly: false,
    })),
  },
}));

vi.mock('../../supervisor/client', () => ({
  supervisorApi: () => ({
    listCities: vi.fn(async () => ({
      items: [
        { name: 'a', path: '/srv/a', running: true },
        { name: 'x', path: '/srv/x', running: true },
      ],
      total: 2,
    })),
  }),
}));

function inRouter(node: React.ReactNode, path = '/') {
  return render(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>);
}

function renderHeader(path = '/') {
  return render(
    <ThemeProvider>
      <ViewingAsProvider>
        <AttentionProvider contributors={[]}>
          <MemoryRouter initialEntries={[path]}>
            <Header />
          </MemoryRouter>
        </AttentionProvider>
      </ViewingAsProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  mocks.count = 0;
  mocks.openCommandBar.mockClear();
  mocks.hardNavigate.mockClear();
  setLocale('ru');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BottomTabs (phone)', () => {
  it('is a phone-only fixed bar with three tabs and a red count', () => {
    mocks.count = 4;
    inRouter(<BottomTabs />);
    const bar = screen.getByRole('navigation', { name: 'Разделы' });
    expect(bar.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['md:hidden', 'fixed', 'bottom-0', 'h-14', 'pb-[var(--saib)]']),
    );
    const labels = within(bar)
      .getAllByText(/^(Нужно от меня|Доска|Поиск)$/)
      .map((n) => n.textContent);
    expect(labels).toEqual(['Нужно от меня', 'Доска', 'Поиск']);
    expect(within(bar).getByTestId('needs-badge').textContent).toBe('4');
    expect(within(bar).getByRole('link', { name: 'Нужно от меня, 4' })).toBeTruthy();
  });

  it('no badge at zero', () => {
    inRouter(<BottomTabs />);
    expect(screen.queryByTestId('needs-badge')).toBeNull();
    expect(screen.getByRole('link', { name: 'Нужно от меня' })).toBeTruthy();
  });

  it('«Поиск» opens the command bar', () => {
    inRouter(<BottomTabs />);
    fireEvent.click(screen.getByRole('button', { name: 'Поиск' }));
    expect(mocks.openCommandBar).toHaveBeenCalledTimes(1);
  });

  it('«Доска» is the current page on /beads', () => {
    inRouter(<BottomTabs />, '/beads');
    expect(screen.getByRole('link', { name: 'Доска' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Нужно от меня' }).hasAttribute('aria-current')).toBe(
      false,
    );
  });

  it('tabs are at least 44 px tall: three equal columns, one 24 px icon each', () => {
    inRouter(<BottomTabs />);
    const bar = screen.getByRole('navigation', { name: 'Разделы' });
    expect(bar.querySelector('ul')!.className).toContain('grid-cols-3');
    for (const tab of [
      screen.getByRole('link', { name: 'Нужно от меня' }),
      screen.getByRole('link', { name: 'Доска' }),
      screen.getByRole('button', { name: 'Поиск' }),
    ]) {
      expect(tab.className).toContain('h-14');
      expect(tab.querySelector('svg')!.getAttribute('width')).toBe('24');
    }
  });
});

describe('TopNav (desktop)', () => {
  it('shows «Нужно от меня» with the amber count and «Доска» (canvas Attention)', () => {
    mocks.count = 4;
    inRouter(<TopNav />);
    const link = screen.getByRole('link', { name: 'Нужно от меня, 4' });
    const badge = within(link).getByTestId('needs-badge');
    expect(badge.textContent).toBe('4');
    // vk-1to1: the canvas header chip is warn on warn-bg, 12 px.
    expect(badge.className).toContain('bg-[var(--vkc-warn-bg)]');
    expect(badge.className).toContain('text-warn');
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Доска' })).toBeTruthy();
  });

  it('the search button opens the command bar', () => {
    inRouter(<TopNav />);
    fireEvent.click(screen.getByRole('button', { name: /Поиск/ }));
    expect(mocks.openCommandBar).toHaveBeenCalledTimes(1);
  });
});

describe('Header (VK top bar)', () => {
  it('city switch goes through hardNavigate, never window.location.assign', async () => {
    const assign = vi.fn();
    const realLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...realLocation, assign },
    });
    try {
      renderHeader();
      const select = (await screen.findByLabelText('Сменить город')) as HTMLSelectElement;
      await screen.findByRole('option', { name: 'x' });
      fireEvent.change(select, { target: { value: 'x' } });
      expect(mocks.hardNavigate).toHaveBeenCalledWith('/city/x/');
      expect(assign).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
    }
  });

  it('debug pages stay reachable from the «Ещё» menu', async () => {
    setLocale('en');
    renderHeader('/runs');
    await screen.findByRole('link', { name: /^Health/ });
    const menu = screen.getByRole('navigation', { name: 'All pages' });
    const labels = Array.from(menu.querySelectorAll('a')).map((a) =>
      (a.textContent ?? '').replace(/\d+$/, '').trim(),
    );
    expect(labels).toEqual(['Home', 'Runs', 'Agents', 'Beads', 'Mail', 'Activity', 'Health']);
  });
});

describe('ProjectRail (canvas left rail)', () => {
  it('is a 56 px desktop rail: menu, DW, ГО, «+», spacer, «А», Mayor', () => {
    inRouter(<ProjectRail />, '/beads');
    const rail = screen.getByRole('navigation', { name: 'Проекты' });
    expect(rail.className.split(/\s+/)).toEqual(
      expect.arrayContaining([
        'w-14',
        'hidden',
        'md:flex',
        'flex-col',
        'gap-2',
        'p-2',
        'bg-vk-bg-secondary',
        'border-r',
      ]),
    );
    const names = [...rail.children].map(
      (el) => el.getAttribute('aria-label') ?? (el.className.includes('flex-1') ? 'spacer' : ''),
    );
    expect(names).toEqual([
      'Меню',
      'Продукт devwork',
      'Сам город',
      'Подключить проект',
      'spacer',
      'Ты',
      'Мэр в Discord',
    ]);
  });

  it('highlights the current project tile with active-bg / active-fg', () => {
    inRouter(<ProjectRail />, '/beads?project=city');
    const go = screen.getByRole('link', { name: 'Сам город' });
    expect(go.getAttribute('aria-current')).toBe('page');
    expect(go.className).toContain('bg-[var(--vkc-active-bg)]');
    expect(go.className).toContain('text-[var(--vkc-active-fg)]');
    const dw = screen.getByRole('link', { name: 'Продукт devwork' });
    expect(dw.getAttribute('aria-current')).toBeNull();
    expect(dw.getAttribute('href')).toBe('/beads?project=devwork');
  });

  it('DW is the default project on the board', () => {
    inRouter(<ProjectRail />, '/beads');
    expect(screen.getByRole('link', { name: 'Продукт devwork' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });
});

describe('Header (canvas 44 px bar)', () => {
  it('centres the city name and has list / help / settings icons', () => {
    renderHeader('/beads');
    expect(screen.getByLabelText('Список')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Помощь' })).toBeTruthy();
    expect(screen.getByLabelText('Настройки')).toBeTruthy();
  });

  it('shows the open task id with a copy-link button on the left', () => {
    renderHeader('/beads?bead=dw-abc');
    const copy = screen.getByRole('button', { name: 'Скопировать ссылку на dw-abc' });
    expect(copy.textContent).toBe('dw-abc');
  });

  it('no task id when no card is open', () => {
    renderHeader('/beads');
    expect(screen.queryByRole('button', { name: /Скопировать ссылку/ })).toBeNull();
  });
});

describe('Layout', () => {
  it('pads main for the phone bar and mounts the bottom tabs', () => {
    const { container } = render(
      <ThemeProvider>
        <ViewingAsProvider>
          <AttentionProvider contributors={[]}>
            <MemoryRouter initialEntries={['/']}>
              <Layout>
                <p>page</p>
              </Layout>
            </MemoryRouter>
          </AttentionProvider>
        </ViewingAsProvider>
      </ThemeProvider>,
    );
    const main = container.querySelector('main')!;
    expect(main.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['pb-[calc(3.5rem+var(--saib))]', 'md:pb-0']),
    );
    const bars = screen
      .getAllByRole('navigation', { name: 'Разделы' })
      .filter((n) => n.className.includes('md:hidden'));
    expect(bars).toHaveLength(1);
    // The top bar sits outside main; the bottom bar is a sibling after it.
    expect(main.contains(bars[0]!)).toBe(false);
  });
});

describe('safe area', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  it('index.css defines the four safe-area insets', () => {
    const css = readFileSync(join(here, '../../styles/index.css'), 'utf8');
    for (const v of ['--sait', '--saib', '--sail', '--sair']) expect(css).toContain(`${v}:`);
    // owner 16.11: no Activity insets; the notch and home indicator only
    expect(css).toContain('--saib: env(safe-area-inset-bottom, 0px);');
  });
  it('index.html opts into viewport-fit=cover', () => {
    const html = readFileSync(join(here, '../../../index.html'), 'utf8');
    expect(html).toMatch(/name="viewport"[^>]*viewport-fit=cover/);
  });
});
