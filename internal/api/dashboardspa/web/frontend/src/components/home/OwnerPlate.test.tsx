import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem, OwnerReadiness } from '../../attention/compose';

const openExternal = vi.hoisted(() => vi.fn());
vi.mock('../../lib/openExternal', () => ({ openExternal }));
import { setLocale } from '../../i18n';
import { OwnerPlate } from './OwnerPlate';

const decision: AttentionItem = {
  id: 'beads:dw-9:mayor-decision',
  domain: 'beads',
  severity: 'attention',
  audience: 'owner',
  ref: 'dw-9',
  title: 'Принять задачу «Вход по ссылке» после третьего круга ревью?',
  summary: 'Мэр',
  href: '/beads?bead=dw-9',
  externalHref: 'https://discord.com/channels/1/2/3',
};

const mail: AttentionItem = {
  id: 'mail:M-1:unread',
  domain: 'mail',
  severity: 'attention',
  audience: 'owner',
  title: 'Нужен доступ к Supabase',
  summary: 'from mayor',
  href: '/mail?message=M-1',
};

function plate(items: readonly AttentionItem[], readiness: OwnerReadiness, onBoard?: boolean) {
  return render(
    <MemoryRouter>
      <OwnerPlate
        items={items}
        readiness={readiness}
        {...(onBoard === undefined ? {} : { questionsOnBoard: onBoard })}
      />
    </MemoryRouter>,
  );
}

describe('OwnerPlate', () => {
  afterEach(() => {
    cleanup();
    setLocale('en');
  });

  it('caps the plate at five rows with Show N more', () => {
    const many = Array.from({ length: 48 }, (_, i) => ({
      ...decision,
      id: `beads:dw-${i}:mayor-decision`,
      title: `Вопрос ${i}`,
    }));
    plate(many, { state: 'ready' });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('48');
    expect(screen.getAllByText(/^Вопрос \d+$/)).toHaveLength(5);
    const more = screen.getByRole('button', { name: 'Show 43 more' });
    fireEvent.click(more);
    expect(screen.getAllByText(/^Вопрос \d+$/)).toHaveLength(48);
    expect(screen.getByRole('button', { name: 'Show fewer' })).toBeTruthy();
  });

  it('five or fewer rows show no fold', () => {
    plate([decision, mail], { state: 'ready' });
    expect(screen.queryByRole('button', { name: /^Show/ })).toBeNull();
  });

  it('the fold speaks Russian', () => {
    setLocale('ru');
    const many = Array.from({ length: 8 }, (_, i) => ({
      ...mail,
      id: `mail:${i}`,
      title: `Письмо ${i}`,
    }));
    plate(many, { state: 'ready' });
    expect(screen.getByRole('button', { name: 'Ещё 3' })).toBeTruthy();
  });

  it('empty and ready is the all-clear sentence', () => {
    plate([], { state: 'ready' });
    expect(
      screen.getByRole('heading', { level: 2, name: 'Nothing waits for you right now.' }),
    ).toBeTruthy();
    expect(screen.getByText('The city is running on its own.')).toBeTruthy();
  });

  it('loading and degraded are never all-clear', () => {
    const { unmount } = plate([], { state: 'loading' });
    expect(screen.queryByText(/Nothing waits/)).toBeNull();
    expect(screen.getByText('Checking whether anything waits for you…')).toBeTruthy();
    unmount();

    plate([], { state: 'degraded', reasons: ['Your mail could not be read'] });
    expect(screen.queryByText(/Nothing waits/)).toBeNull();
    expect(screen.getByText('Could not check: Your mail could not be read.')).toBeTruthy();
  });

  it('degraded with items still lists them and names what failed', () => {
    plate([mail], { state: 'degraded', reasons: ['Questions from the Mayor could not be read'] });
    expect(screen.getByRole('heading', { name: '1 thing waits for you' })).toBeTruthy();
    expect(screen.getByText(/Could not check: Questions from the Mayor/)).toBeTruthy();
  });

  it('counts with russian plural', () => {
    setLocale('ru');
    plate([decision, mail], { state: 'ready' });
    expect(screen.getByRole('heading', { name: 'Вас ждут 2 дела' })).toBeTruthy();
  });

  it('decision row opens the chat through openExternal and links to the bead', () => {
    plate([decision], { state: 'ready' });
    const chat = screen.getByRole('link', { name: 'Answer in chat' });
    expect(chat.getAttribute('href')).toBe('https://discord.com/channels/1/2/3');
    // vk: no target="_blank"; ExternalLink hands the URL to openExternal.
    expect(chat.getAttribute('target')).toBeNull();
    expect(chat.getAttribute('rel')).toBe('noopener noreferrer');
    fireEvent.click(chat);
    expect(openExternal).toHaveBeenCalledWith('https://discord.com/channels/1/2/3');
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe(
      '/beads?bead=dw-9',
    );
    expect(screen.getByText('dw-9')).toBeTruthy();
  });

  it('russian decision row says «Ответить в чате»', () => {
    setLocale('ru');
    plate([decision], { state: 'ready' });
    expect(screen.getByRole('link', { name: 'Ответить в чате' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Открыть' })).toBeTruthy();
  });

  it('long question wraps', () => {
    const url = `https://example.com/${'a'.repeat(100)}`;
    const long = { ...decision, title: `${'Вопрос '.repeat(40)}${url}` };
    plate([long], { state: 'ready' });
    const title = screen.getByText((_, el) => el?.textContent === long.title && el.tagName === 'P');
    expect(title.className).toContain('[overflow-wrap:anywhere]');
  });

  it('no role alert', () => {
    plate([decision, mail], { state: 'ready' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('flag off shows the chat sentence', () => {
    plate([], { state: 'ready' }, false);
    expect(screen.getByText('Questions from the Mayor arrive in the chat.')).toBeTruthy();
    plate([], { state: 'ready' }, true);
    expect(screen.getAllByText('Questions from the Mayor arrive in the chat.')).toHaveLength(1);
  });

  it('section is labelled by its headline', () => {
    plate([mail], { state: 'ready' });
    expect(screen.getByRole('region', { name: '1 thing waits for you' })).toBeTruthy();
  });
});
