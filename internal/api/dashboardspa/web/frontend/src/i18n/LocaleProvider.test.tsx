import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale, t } from './index';
import { LocaleProvider, useLocale } from './LocaleProvider';

function HomeLabel() {
  return <span>{t('Home')}</span>;
}

function LocaleReadout() {
  const { locale } = useLocale();
  return <span data-testid="locale">{locale}</span>;
}

describe('LocaleProvider', () => {
  afterEach(() => {
    setLocale('en');
    window.localStorage.clear();
  });

  it('toggle re-renders', () => {
    setLocale('en');
    render(
      <LocaleProvider>
        <HomeLabel />
        <LocaleReadout />
      </LocaleProvider>,
    );
    expect(screen.getByText('Home')).toBeTruthy();
    expect(screen.getByTestId('locale').textContent).toBe('en');

    act(() => setLocale('ru'));

    expect(screen.getByText('Главная')).toBeTruthy();
    expect(screen.getByTestId('locale').textContent).toBe('ru');
    expect(document.documentElement.lang).toBe('ru');
  });

  it('useLocale setLocale switches the language', () => {
    function Switcher() {
      const { setLocale: change } = useLocale();
      return (
        <button type="button" onClick={() => change('ru')}>
          {t('Home')}
        </button>
      );
    }
    render(
      <LocaleProvider>
        <Switcher />
      </LocaleProvider>,
    );
    act(() => screen.getByRole('button').click());
    expect(screen.getByRole('button').textContent).toBe('Главная');
  });
});
