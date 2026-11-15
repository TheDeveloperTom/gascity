import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttentionProvider } from '../attention/context';
import type { AttentionContributor, AttentionItem } from '../attention/compose';
import { ThemeProvider } from '../contexts/ThemeContext';
import { ViewingAsProvider } from '../contexts/ViewingAsContext';
import { Header } from './Header';

// Final review Minor 6 and top-3 #3: at 390 px every nav count pill sits
// off-screen in the scrolling row. The phone top bar carries one compact red
// "N need you" chip (attention only, the Home board's number), and the
// active nav item scrolls into view inside the row.

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

  // Task 9: the chip is the owner slice's total; city items never count.
  it('shows one red "need you" chip counting owner items only, outside the nav', async () => {
    const { container } = renderHeader([
      contributor('beads', [
        { ...item('b1', 'beads', 'attention'), audience: 'owner' },
        item('b2', 'beads', 'attention'),
      ]),
      contributor('mail', [{ ...item('m1', 'mail', 'attention'), audience: 'owner' }]),
    ]);
    const chip = await screen.findByRole('link', { name: '2 need you' });
    expect(chip.getAttribute('href')).toBe('/');
    expect(chip.className).toContain('lg:hidden');
    expect(chip.className).toContain('bg-accent');
    expect(container.querySelector('header nav')!.contains(chip)).toBe(false);
  });

  it('no chip when nothing needs you', () => {
    renderHeader([contributor('mail', [item('m1', 'mail', 'watch')])]);
    expect(screen.queryByRole('link', { name: /need you/ })).toBeNull();
  });

  it('scrolls the active nav item into view inside the row', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(820);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const isActive = this.getAttribute('aria-current') === 'page';
      const left = isActive ? 600 : 0;
      const width = isActive ? 100 : 390;
      return {
        left,
        width,
        right: left + width,
        top: 0,
        bottom: 40,
        height: 40,
        x: left,
        y: 0,
      } as DOMRect;
    });
    const { container } = renderHeader([], '/health');
    const nav = container.querySelector('header nav') as HTMLElement;
    // Centre the active item: 600 - (390 - 100) / 2 = 455.
    expect(nav.scrollLeft).toBe(455);
  });
});
