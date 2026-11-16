import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttentionProvider } from '../attention/context';
import type { AttentionContributor, AttentionItem } from '../attention/compose';
import { ThemeProvider } from '../contexts/ThemeContext';
import { ViewingAsProvider } from '../contexts/ViewingAsContext';
import { Header } from './Header';

// The VK top bar at 390 px (vk lane 5): sections move to the bottom tabs, the
// top row keeps the city, the «Ещё» page menu and the toggles at 44 px.

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
vi.mock('../lib/needsFromMe', () => ({ useNeedsFromMeCount: () => 0, useNeedsFromMeIncomplete: () => false }));

vi.mock('../supervisor/client', () => ({
  supervisorApi: () => ({
    listCities: vi.fn(async () => ({
      items: [{ name: 'test-city', path: '/srv/test-city', running: true }],
      total: 1,
    })),
  }),
}));

function item(
  id: string,
  domain: AttentionItem['domain'],
  severity: AttentionItem['severity'],
): AttentionItem {
  return { id, domain, severity, title: id, href: `/${domain}`, current: true, actionable: false };
}

function contributor(
  domain: AttentionItem['domain'],
  items: readonly AttentionItem[],
): AttentionContributor {
  return { id: `${domain}-test`, domain, getItems: () => items };
}

function renderHeader(contributors: readonly AttentionContributor[], path = '/runs') {
  return render(
    <ThemeProvider>
      <ViewingAsProvider>
        <AttentionProvider contributors={contributors}>
          <MemoryRouter initialEntries={[path]}>
            <Header />
          </MemoryRouter>
        </AttentionProvider>
      </ViewingAsProvider>
    </ThemeProvider>,
  );
}

describe('Header on phones', () => {
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
    vi.restoreAllMocks();
  });

  // vk lane 5 (ruling 4): the phone count lives on the «Нужно от меня» bottom
  // tab now, so the top bar carries no "need you" chip and no scrolling row.
  it('no "need you" chip in the top bar, even with owner items', () => {
    renderHeader([
      contributor('mail', [{ ...item('m1', 'mail', 'attention'), audience: 'owner' }]),
    ]);
    expect(screen.queryByRole('link', { name: /need you/ })).toBeNull();
  });

  it('the bar is a plain row on phones and sticky from md', () => {
    const { container } = renderHeader([]);
    const cls = container.querySelector('header')!.className.split(/\s+/);
    expect(cls).toEqual(expect.arrayContaining(['md:sticky', 'md:top-0']));
    expect(cls).not.toContain('sticky');
  });

  it('every bar control is a 44 px target on phones', () => {
    const { container } = renderHeader([]);
    const controls = container.querySelectorAll(
      'header summary, header > div > div:last-child > button',
    );
    expect(controls.length).toBeGreaterThanOrEqual(3);
    for (const c of Array.from(controls)) expect(c.className.split(/\s+/)).toContain('h-11');
  });

  it('the active debug page is marked inside the «Ещё» menu', async () => {
    const { container } = renderHeader([], '/health');
    await screen.findByRole('link', { name: /^Health/ });
    const active = container.querySelector('header details nav a[aria-current="page"]');
    expect(active?.getAttribute('href')).toBe('/health');
  });
});
