import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidate } from '../api/cache';
import { AttentionProvider } from '../attention/context';
import type { AttentionContributor, AttentionItem } from '../attention/compose';
import { ThemeProvider } from '../contexts/ThemeContext';
import { ViewingAsProvider } from '../contexts/ViewingAsContext';
import { Header } from './Header';
import { Layout } from './Layout';

// The VK top bar (vk lane 5, ruling 4, replaces the DESIGN-PLAN §6.1 rail):
// the «Ещё» page menu keeps the three signpost groups and signal count pills;
// the theme toggle is an icon.

vi.mock('../api/client', () => ({
  api: {
    config: vi.fn(async () => ({
      cityName: 'test-city',
      defaultView: null,
      enabledModules: [],
      readOnly: false,
    })),
  },
}));

// vk integration: TopNav's badge reads lane 3's real board model; isolate the
// header from the board reads (the count is tested in vk/shell/shell.test.tsx).
vi.mock('../lib/needsFromMe', () => ({ useNeedsFromMeCount: () => 0 }));

vi.mock('../supervisor/client', () => ({
  supervisorApi: () => ({
    listCities: vi.fn(async () => ({
      items: [{ name: 'test-city', path: '/srv/test-city', running: true }],
      total: 1,
    })),
  }),
}));

describe('Header top bar', () => {
  beforeEach(() => {
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
  });

  // vk lane 5 (ruling 4): the rail became the VK top bar. It holds two navs:
  // the section tabs (desktop) and the «Ещё» menu with every page.
  // H1 16.11 (live, every first paint): before the city list loaded the top
  // bar showed a switcher reading «devwork-platform (не найден)», then
  // snapped to the plain name. An unloaded list is not a miss.
  it('does not call the city unknown while the city list is still loading', async () => {
    invalidate('cities');
    renderHeader([]);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText(/\(unknown\)/)).toBeNull();
    await screen.findByText('test-city');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('two navs inside the header: section tabs and the page menu', () => {
    const { container } = renderHeader([]);
    const navs = Array.from(container.querySelector('header')!.querySelectorAll('nav'));
    expect(navs.map((n) => n.getAttribute('aria-label'))).toEqual(['Sections', 'All pages']);
  });

  it('three groups in signpost order', async () => {
    const { container } = renderHeader([]);
    // Registry views (Activity, Health) join once the config read settles.
    await screen.findByRole('link', { name: /^Health/ });
    const nav = container.querySelector('header details nav')!;
    expect(nav.querySelectorAll('ul')).toHaveLength(3);
    const labels = Array.from(nav.querySelectorAll('a')).map((a) => linkLabel(a));
    expect(labels).toEqual(['Home', 'Runs', 'Agents', 'Beads', 'Mail', 'Activity', 'Health']);
  });

  // Task 9 (supersedes SH-12): red counts owner items per domain; city items
  // (runs, unless they wait for the owner) are one amber count on Health.
  it('signal pills', async () => {
    renderHeader([
      contributor('runs', [item('run-1', 'runs', 'attention'), item('run-2', 'runs', 'watch')]),
      contributor('mail', [{ ...item('mail-1', 'mail', 'watch'), audience: 'owner' }]),
    ]);
    const mail = await screen.findByLabelText('Mail: 1 attention item');
    expect(mail.className).toContain('bg-accent');
    expect(mail.textContent).toBe('1');
    expect(screen.queryByLabelText(/^Runs:/)).toBeNull();
    expect((await screen.findByLabelText('Health: 2 city issues')).className).toContain('bg-warn');
  });

  it('page menu links are 44 px tall on phones', () => {
    const { container } = renderHeader([]);
    const links = container.querySelectorAll('header details nav a');
    expect(links.length).toBeGreaterThan(0);
    for (const a of Array.from(links)) expect(a.className.split(/\s+/)).toContain('h-11');
  });

  it('the content column starts at the rail (left-aligned, full width — owner 16.11)', () => {
    const { container } = render(
      <ThemeProvider>
        <ViewingAsProvider>
          <AttentionProvider contributors={[]}>
            {/* Dashboard v3: `/` is a wide owner page; a debug page keeps the measure. */}
            <MemoryRouter initialEntries={['/runs']}>
              <Layout>
                <p>page</p>
              </Layout>
            </MemoryRouter>
          </AttentionProvider>
        </ViewingAsProvider>
      </ThemeProvider>,
    );
    const column = container.querySelector('main')!.firstElementChild as HTMLElement;
    expect(column.className).not.toContain('max-w-');
    expect(column.className.split(/\s+/)).not.toContain('mx-auto');
  });

  // polish2 16.11 (owner): «DW» / «ГО» were two hover-only tiles that
  // controlled nothing; they are gone (the scope lives in the board's
  // «Проект» menu: «Продукт devwork», «Город (служебное)»).
  it('no cryptic two-letter scope tiles in the top bar', () => {
    const { container } = renderHeader([]);
    const header = container.querySelector('header')!;
    for (const el of Array.from(header.querySelectorAll('span'))) {
      expect(['DW', 'ГО']).not.toContain(el.textContent?.trim());
    }
    expect(header.querySelector('[title="devwork product"]')).toBeNull();
    expect(header.querySelector('[title="The city itself"]')).toBeNull();
  });

  it('theme toggle', () => {
    renderHeader([]);
    const toggle = screen.getByRole('button', { name: /Switch to (dark|light) theme/ });
    expect(toggle.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});

/** The visible label of a nav link: its text without the count pill. */
function linkLabel(link: Element): string {
  const pill = link.querySelector('[aria-label]');
  const text = link.textContent ?? '';
  return (pill ? text.replace(pill.textContent ?? '', '') : text).trim();
}

function renderHeader(contributors: readonly AttentionContributor[]) {
  return render(
    <ThemeProvider>
      <ViewingAsProvider>
        <AttentionProvider contributors={contributors}>
          <MemoryRouter initialEntries={['/runs']}>
            <Header />
          </MemoryRouter>
        </AttentionProvider>
      </ViewingAsProvider>
    </ThemeProvider>,
  );
}

function contributor(
  domain: AttentionItem['domain'],
  items: readonly AttentionItem[],
): AttentionContributor {
  return {
    id: `${domain}-test`,
    domain,
    getItems: () => items,
  };
}

function item(
  id: string,
  domain: AttentionItem['domain'],
  severity: AttentionItem['severity'],
): AttentionItem {
  return {
    id,
    domain,
    severity,
    title: id,
    href: `/${domain}`,
    current: true,
    actionable: false,
  };
}
