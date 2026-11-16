import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TaskStages } from '../../hooks/useTaskStages';
import { collectMissing, resetMissing, setLocale } from '../../i18n';
import type { NeedsModel } from '../../lib/needsFromMe';
import { topicNeedsOf } from '../../lib/peerTopics';
import { parsePeerBoards } from '../../supervisor/peerBoardReads';
import { peerBody, peerTopics } from '../../test/fixtures/peerBoards';
import { NeedsShelves } from './Shelf';

// vk-final part 4: «Нужно от меня» lists every needs_human topic («Мэры не
// договорились») and open topics with unread messages, with the summary as
// the preview. A paused topic counts in the badge number; unread does not.

const STAGES: TaskStages = { state: 'ready', inFlight: [], queued: 0, outsideWindow: 0 };
const EMPTY: NeedsModel = { state: 'ready', needs: [], stalls: [], quiet: [], count: 0, questionCount: 0 };
const NOW = Date.parse('2026-11-15T19:00:00Z');

beforeEach(() => {
  setLocale('ru');
  resetMissing();
});
afterEach(() => {
  cleanup();
  setLocale('en');
});

describe('«Нужно от меня» topics', () => {
  it('a paused topic and an unread one, each linking to its thread', () => {
    const topicNeeds = topicNeedsOf(parsePeerBoards(peerBody({ topics: peerTopics() })), NOW);
    render(
      <MemoryRouter>
        <NeedsShelves model={{ ...EMPTY, count: 1 }} stages={STAGES} topicNeeds={topicNeeds} />
      </MemoryRouter>,
    );
    const section = screen.getByRole('region', { name: 'Обсуждения Мэров' });
    const paused = within(section).getByRole('link', { name: /Кто обновляет Node 24/ });
    expect(paused.getAttribute('href')).toBe('/beads?topics=rich&topic=tp-bbbbbbbbbbbbbbbbbbbb');
    expect(paused.textContent).toContain('Мэры не договорились — нужен человек');
    const unread = within(section).getByRole('link', { name: /Перезагрузка общего CI/ });
    expect(unread.textContent).toContain('Можно ли в 22:00 перезагрузить CI?');
    expect(unread.textContent).toContain('1 новое');
    // the empty «nothing needs you» line is not shown while topics need you
    expect(screen.queryByText('Сейчас от тебя ничего не нужно.')).toBeNull();
    expect(collectMissing()).toEqual([]);
  });

  it('no topics: no section', () => {
    render(
      <MemoryRouter>
        <NeedsShelves model={EMPTY} stages={STAGES} topicNeeds={[]} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('region', { name: 'Обсуждения Мэров' })).toBeNull();
  });
});
