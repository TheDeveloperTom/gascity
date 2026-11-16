import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../i18n';
import type { SupervisorBead } from '../../supervisor/beadReads';
import { GraphChain } from './GraphChain';

// Owner 16.11 (all-tickets graph): a question card's drawer showed «Почему
// стоит» and «Её ждут» headings with nothing under them. An empty section is
// not drawn.

function bead(id: string, title: string, extra: Partial<SupervisorBead> = {}): SupervisorBead {
  return { id, title, status: 'open', issue_type: 'task', created_at: '2026-11-15T08:00:00Z', labels: ['milestone:M04'], ...extra };
}

beforeEach(() => act(() => setLocale('en')));
afterEach(() => cleanup());

describe('GraphChain empty sections', () => {
  it('draws neither heading when nothing stands in the way and nobody waits', () => {
    const lone = bead('dw-q', 'M04 #9 — Вопрос');
    render(<GraphChain bead={lone} items={[lone]} onOpenBead={() => {}} />);
    expect(screen.queryByRole('region', { name: 'Why it stands' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Waiting on it' })).toBeNull();
  });

  it('draws only the section that has rows', () => {
    const a = bead('dw-a', 'M04 #1 — Первая');
    const b = bead('dw-b', 'M04 #2 — Вторая', { needs: ['dw-a'] });
    render(<GraphChain bead={a} items={[a, b]} onOpenBead={() => {}} />);
    expect(screen.queryByRole('region', { name: 'Why it stands' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Waiting on it' })).toBeTruthy();
  });
});
