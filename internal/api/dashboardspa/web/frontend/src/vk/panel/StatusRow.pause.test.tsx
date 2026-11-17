import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../i18n';
import { pauseOf } from '../../lib/pause';
import { StatusRow } from './TaskDrawer';

beforeEach(() => setLocale('ru'));
afterEach(() => {
  cleanup();
  setLocale('en');
});

describe('the drawer status row of a paused card', () => {
  it('says «На паузе: <reason> (кто, когда)» next to the status', () => {
    const pause = pauseOf({
      id: 'dw-1',
      title: 't',
      status: 'in_progress',
      issue_type: 'task',
      created_at: '2026-11-15T08:00:00Z',
      labels: ['hold:mayor'],
      metadata: { 'devwork.pause_reason': 'mayor, 2026-11-16T08:12:00Z: ждём решения' },
    });
    render(
      <StatusRow
        status="in_progress"
        owner={{ letter: 'А', tone: 'owner', name: 'Артём' }}
        worker={null}
        kind="Задача"
        tag={null}
        pause={pause}
      />,
    );
    expect(screen.getByTestId('task-pause').textContent).toBe('На паузе: ждём решения (mayor, 16.11 08:12 UTC)');
  });

  it('no pause, no line', () => {
    render(
      <StatusRow status="open" owner={{ letter: 'А', tone: 'owner', name: null }} worker={null} kind="Задача" tag={null} />,
    );
    expect(screen.queryByTestId('task-pause')).toBeNull();
  });
});
