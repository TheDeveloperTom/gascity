import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import type { AttentionDomain, AttentionItem } from '../../attention/compose';
import { setLocale } from '../../i18n';
import { CityIssues } from './CityIssues';

function item(
  id: string,
  domain: AttentionDomain,
  extra: Partial<AttentionItem> & { ref?: string } = {},
): AttentionItem {
  return {
    id,
    domain,
    severity: 'watch',
    title: `Title ${id}`,
    href: `/${domain}`,
    ...extra,
  } as AttentionItem;
}

function slice(items: readonly AttentionItem[]) {
  const byDomain = { agents: 0, beads: 0, runs: 0, mail: 0, activity: 0, health: 0 };
  for (const i of items) byDomain[i.domain] += 1;
  return { items, total: items.length, byDomain };
}

function renderIssues(items: readonly AttentionItem[], unreadable: readonly AttentionItem[] = []) {
  return render(
    <MemoryRouter>
      <CityIssues slice={slice(items)} unreadable={unreadable} />
    </MemoryRouter>,
  );
}

describe('CityIssues', () => {
  afterEach(() => {
    cleanup();
    setLocale('en');
  });

  it('lists every city item, none hidden', () => {
    const items = [
      ...Array.from({ length: 20 }, (_, n) => item(`b${n}`, 'beads')),
      ...Array.from({ length: 12 }, (_, n) => item(`r${n}`, 'runs')),
      ...Array.from({ length: 8 }, (_, n) => item(`a${n}`, 'agents')),
    ];
    renderIssues(items);
    const section = screen
      .getByRole('heading', { level: 2, name: 'City issues' })
      .closest('section')!;
    // Five per group visible.
    expect(within(section).getAllByRole('listitem')).toHaveLength(15);
    for (const button of within(section).getAllByRole('button', { name: /Show all/ })) {
      fireEvent.click(button);
    }
    expect(within(section).getAllByRole('listitem')).toHaveLength(40);
    expect(within(section).getByText('Title b19')).toBeTruthy();
    expect(within(section).getByText('Title r11')).toBeTruthy();
    expect(within(section).getByText('Title a7')).toBeTruthy();
  });

  it('rows are named, carry the ref as a tag and link', () => {
    renderIssues([
      item('x', 'beads', { title: 'Fix the gate', ref: 'de-42', href: '/beads?id=de-42' }),
    ]);
    const link = screen.getByRole('link', { name: /Fix the gate/ });
    expect(link.getAttribute('href')).toBe('/beads?id=de-42');
    const tag = screen.getByText('de-42');
    expect(tag.className).toContain('font-mono');
  });

  it('empty state', () => {
    renderIssues([]);
    expect(screen.getByText('No city issues')).toBeTruthy();
  });

  it('empty state in Russian', () => {
    setLocale('ru');
    renderIssues([]);
    expect(screen.getByRole('heading', { level: 2, name: 'Неполадки города' })).toBeTruthy();
    expect(screen.getByText('Неполадок нет')).toBeTruthy();
  });

  it('unreadable sources are said, never counted as all clear', () => {
    renderIssues(
      [],
      [item('u1', 'runs', { severity: 'unavailable', title: 'Runs could not be read' })],
    );
    expect(screen.getByText('Runs could not be read')).toBeTruthy();
    expect(screen.queryByText('No city issues')).toBeNull();
  });
});
