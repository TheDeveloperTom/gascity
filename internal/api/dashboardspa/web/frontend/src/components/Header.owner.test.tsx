import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttentionProvider } from '../attention/context';
import type { AttentionContributor } from '../attention/compose';
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
});
