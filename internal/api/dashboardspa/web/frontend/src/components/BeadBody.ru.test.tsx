import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectMissing, resetMissing, setLocale } from '../i18n';
import type { SupervisorBead } from '../supervisor/beadReads';
import { BeadBody } from './BeadBody';
import { RelatedEntities } from './RelatedEntities';

// H1 16.11 (live drawer, «Подробности»): «Status / Type / Assignee / Created»,
// «Related», «No related entities.» read English on the Russian UI.

const BEAD: SupervisorBead = {
  id: 'dw-1',
  title: 'Задача',
  status: 'open',
  issue_type: 'task',
  created_at: '2026-11-15T10:00:00Z',
  labels: ['milestone:M04'],
};

describe('the drawer details in Russian', () => {
  beforeEach(() => {
    setLocale('ru');
    resetMissing();
  });
  afterEach(() => {
    cleanup();
    setLocale('en');
  });

  it('labels the bead fields in Russian', () => {
    render(<BeadBody bead={BEAD} />);
    for (const label of ['Статус', 'Тип', 'Исполнитель', 'Создана', 'Метки']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(collectMissing()).toEqual([]);
  });

  it('names the related section and its empty state in Russian', () => {
    render(
      <MemoryRouter>
        <RelatedEntities view={null} loading={false} error={null} now={Date.now()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Связанное' })).toBeTruthy();
    expect(screen.getByText('Связанного нет.')).toBeTruthy();
    expect(collectMissing()).toEqual([]);
  });
});
