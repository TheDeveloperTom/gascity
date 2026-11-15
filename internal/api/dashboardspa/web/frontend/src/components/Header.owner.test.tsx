import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttentionProvider } from '../attention/context';
import type { AttentionContributor, AttentionItem } from '../attention/compose';
import { ThemeProvider } from '../contexts/ThemeContext';
import { ViewingAsProvider } from '../contexts/ViewingAsContext';
import { LOCALE_STORAGE_KEY, setLocale } from '../i18n';
import { LocaleProvider } from '../i18n/LocaleProvider';
import { Header } from './Header';

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

function renderHeader(contributors: readonly AttentionContributor[] = []) {
  return render(
    <LocaleProvider>
      <ThemeProvider>
        <ViewingAsProvider>
          <AttentionProvider contributors={contributors}>
            <MemoryRouter initialEntries={['/runs']}>
              <Header />
            </MemoryRouter>
          </AttentionProvider>
        </ViewingAsProvider>
      </ThemeProvider>
    </LocaleProvider>,
  );
}

function navText(container: HTMLElement): string {
  return container.querySelector('header nav')!.textContent ?? '';
}

describe('Header language toggle', () => {
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
    setLocale('en');
    window.localStorage.removeItem(LOCALE_STORAGE_KEY);
  });

  it('toggle switches the nav to Russian and back', async () => {
    const { container } = renderHeader();
    expect(navText(container)).toContain('Beads');

    fireEvent.click(screen.getByRole('button', { name: 'Switch language to Russian' }));
    const nav = container.querySelector('header nav') as HTMLElement;
    expect(within(nav).getByText('Задачи')).toBeTruthy();
    expect(within(nav).getByText('Прогоны')).toBeTruthy();
    expect(within(nav).getByText('Здоровье')).toBeTruthy();
    expect(document.documentElement.lang).toBe('ru');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ru');

    const back = screen.getByRole('button', { name: 'Switch language to English' });
    expect(back.textContent).toContain('EN');
    fireEvent.click(back);
    expect(navText(container)).toContain('Beads');
    expect(
      screen.getByRole('button', { name: 'Switch language to Russian' }).textContent,
    ).toContain('RU');
  });

  it('theme toggle speaks Russian too', () => {
    setLocale('ru');
    renderHeader();
    expect(
      screen.getByRole('button', { name: /Переключить на (тёмную|светлую) тему/ }),
    ).toBeTruthy();
  });

  it('phone nav still one row in Russian', () => {
    setLocale('ru');
    const { container } = renderHeader();
    const nav = container.querySelector('header nav') as HTMLElement;
    expect(nav.className).toContain('overflow-x-auto');
    expect(nav.className).toContain('whitespace-nowrap');
    expect(within(nav).getByText('Главная')).toBeTruthy();
  });

  it('pills count owner items only', async () => {
    renderHeader([
      contributor('mail', [
        item('mail-1', 'mail', 'attention', 'owner'),
        item('mail-2', 'mail', 'watch', 'owner'),
        item('mail-3', 'mail', 'attention'),
      ]),
      contributor('runs', [item('run-1', 'runs', 'attention'), item('run-2', 'runs', 'watch')]),
      contributor('agents', [item('agent-1', 'agents', 'attention', 'owner')]),
    ]);
    const mail = await screen.findByLabelText('Mail: 2 attention items');
    expect(mail.textContent).toBe('2');
    expect(mail.className).toContain('bg-accent');
    expect(screen.getByLabelText('Agents: 1 attention item').textContent).toBe('1');
    // Runs items are the city's: no badge on Runs.
    expect(screen.queryByLabelText(/^Runs:/)).toBeNull();
    // The phone chip is the owner total.
    expect(screen.getByRole('link', { name: '3 need you' })).toBeTruthy();
  });

  it('health pill counts city items in amber', async () => {
    renderHeader([
      contributor('runs', [item('run-1', 'runs', 'attention'), item('run-2', 'runs', 'watch')]),
      contributor('health', [
        item('health-1', 'health', 'watch'),
        item('health-2', 'health', 'unavailable'),
      ]),
      contributor('mail', [item('mail-1', 'mail', 'attention', 'owner')]),
    ]);
    const health = await screen.findByLabelText('Health: 3 city issues');
    expect(health.textContent).toBe('3');
    expect(health.className).toContain('bg-warn');
    expect(screen.queryByLabelText(/^Health: .*attention/)).toBeNull();
  });

  it('health pill reads Russian', async () => {
    setLocale('ru');
    renderHeader([contributor('runs', [item('run-1', 'runs', 'watch')])]);
    expect((await screen.findByLabelText('Здоровье: 1 неполадка города')).textContent).toBe('1');
  });
});

function contributor(
  domain: AttentionItem['domain'],
  items: readonly AttentionItem[],
): AttentionContributor {
  return { id: `${domain}-test`, domain, getItems: () => items };
}

function item(
  id: string,
  domain: AttentionItem['domain'],
  severity: AttentionItem['severity'],
  audience?: AttentionItem['audience'],
): AttentionItem {
  return {
    id,
    domain,
    severity,
    title: id,
    href: `/${domain}`,
    ...(audience !== undefined ? { audience } : {}),
  };
}
