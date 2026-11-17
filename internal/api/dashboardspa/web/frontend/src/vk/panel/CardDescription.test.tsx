import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectMissing, resetMissing, setLocale } from '../../i18n';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { CardDescription } from './CardDescription';
import { PeerTaskDrawer } from './PeerTaskDrawer';

// Owner 17.11: own and peer card drawers render the description the same
// way — headings, a checklist, code, machine lines under «Подробнее», and the
// card's screenshots as thumbnails that open full size.

const TEXT = [
  'Что сделать',
  'Сделать надписи контрастными.',
  'Готово, когда',
  'Тест lib/theme/fill-ink.test.ts зелёный',
  'Справка',
  'Скриншот владельца',
  'Происхождение: owner:msg:1572325038508474550',
].join('\n');

beforeEach(() => {
  setLocale('ru');
  resetMissing();
});
afterEach(() => {
  cleanup();
  setLocale('en');
});

describe('CardDescription', () => {
  it('draws headings, a checklist and code; machine lines sit closed under «Подробнее»', () => {
    render(<CardDescription text={TEXT} beadId="dw-1" headingFrom={3} />);
    const box = screen.getByTestId('task-description');
    expect(within(box).getByRole('heading', { level: 4, name: 'Что сделать' })).toBeTruthy();
    expect(within(box).getByRole('heading', { level: 4, name: 'Готово, когда' })).toBeTruthy();
    const item = within(box).getByRole('listitem');
    expect(item.querySelector('code')?.textContent).toBe('lib/theme/fill-ink.test.ts');
    const more = box.querySelector('details');
    expect(more).not.toBeNull();
    expect(more?.open).toBe(false);
    expect(more?.querySelector('summary')?.textContent).toBe('Подробнее');
    expect(more?.textContent).toContain('owner:msg:1572325038508474550');
    expect(box.textContent?.indexOf('Происхождение')).toBeGreaterThan(box.textContent?.indexOf('Справка') ?? 0);
    expect(collectMissing()).toEqual([]);
  });

  it('shows the card’s screenshots as thumbnails linking to the full image', () => {
    render(
      <CardDescription
        text={'Что сделать\nX'}
        beadId="dw-1"
        city="dw"
        metadata={{ 'devwork.attachments': '["1-image.png"]' }}
      />,
    );
    const link = screen.getByRole('link', { name: 'Скриншот 1' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/api/city/dw/attachments/dw-1/1-image.png');
    expect(link.target).toBe('_blank');
    expect(link.querySelector('img')?.getAttribute('src')).toBe('/api/city/dw/attachments/dw-1/1-image.png');
    expect(collectMissing()).toEqual([]);
  });

  it('an outside image (the page allows same-origin images only) is a link, not a broken thumbnail', () => {
    render(<CardDescription text="![x](https://cdn.example.com/a.png)" beadId="dw-1" />);
    const link = screen.getByRole('link', { name: 'Скриншот 1' });
    expect(link.getAttribute('href')).toBe('https://cdn.example.com/a.png');
    expect(link.querySelector('img')).toBeNull();
  });

  it('no «Подробнее» and no images when there are none', () => {
    render(<CardDescription text="просто текст" beadId="dw-1" />);
    expect(screen.getByTestId('task-description').querySelector('details')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('PeerTaskDrawer description', () => {
  it('renders the peer card the same way as our own', () => {
    const bead = { id: 'dw-c3a', title: 'Кнопки', status: 'open', description: TEXT } as unknown as SupervisorBead;
    render(
      <PeerTaskDrawer
        open
        onClose={() => {}}
        bead={bead}
        rig="devwork"
        name="Ричард"
        label="Ричарда"
        avatar="Р"
        asOf=""
        stale={false}
      />,
    );
    const box = screen.getByTestId('task-description');
    expect(within(box).getByRole('heading', { name: 'Готово, когда' })).toBeTruthy();
    expect(box.querySelector('details summary')?.textContent).toBe('Подробнее');
  });
});
