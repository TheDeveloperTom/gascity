import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttentionProvider } from '../attention/context';
import type { AttentionContributor, AttentionItem } from '../attention/compose';
import { ThemeProvider } from '../contexts/ThemeContext';
import { ViewingAsProvider } from '../contexts/ViewingAsContext';
import { Header } from './Header';

// Left rail (DESIGN-PLAN §6.1, R6): one nav inside the header, three
// signpost groups, signal count pills, an icon on the theme toggle.

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

describe('Header left rail', () => {
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

  it('one nav inside the header', () => {
    const { container } = renderHeader([]);
    expect(container.querySelector('header')!.querySelectorAll('nav')).toHaveLength(1);
  });

  it('three groups in signpost order', async () => {
    const { container } = renderHeader([]);
    // Registry views (Activity, Health) join once the config read settles.
    await screen.findByRole('link', { name: /^Health/ });
    const nav = container.querySelector('header nav')!;
    expect(nav.querySelectorAll('ul')).toHaveLength(3);
    const labels = Array.from(nav.querySelectorAll('a')).map((a) => linkLabel(a));
    expect(labels).toEqual(['Home', 'Runs', 'Agents', 'Beads', 'Mail', 'Activity', 'Health']);
  });

  it('signal pills', async () => {
    renderHeader([
      contributor('runs', [item('run-1', 'runs', 'attention'), item('run-2', 'runs', 'watch')]),
      contributor('mail', [item('mail-1', 'mail', 'watch')]),
    ]);
    const runs = await screen.findByLabelText('Runs: 2 attention items');
    expect(runs.className).toContain('bg-accent');
    expect(runs.textContent).toBe('2');
    expect(screen.getByLabelText('Mail: 1 watch item').className).toContain('bg-warn');
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
