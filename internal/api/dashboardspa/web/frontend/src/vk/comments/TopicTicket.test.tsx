import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectMissing, resetMissing, setLocale } from '../../i18n';
import { peerSourcesOf } from '../../lib/boardOwner';
import { parsePeerBoards } from '../../supervisor/peerBoardReads';
import { ownerQuestion, peerBody, peerTopics } from '../../test/fixtures/peerBoards';
import { TopicsPanel } from './TopicsPanel';

// BOARD-LIVE L7 + ruling 6: «Сделать задачей» starts only from the owner's
// button on the Mayor's Discord message; the dashboard never creates a task and never posts to peer-boards for it. The
// Mayor links the ticket; the topic then shows «→ задача <id>».
// Review N-1: the ticket is a link only on OUR own topics, and only when it
// is a valid bead id; his ticket names a card on HIS board.

const NOW = Date.parse('2026-11-15T19:00:00Z');
const OURS = 'tp-bbbbbbbbbbbbbbbbbbbb';
const HIS = 'tp-aaaaaaaaaaaaaaaaaaaa';

function renderTopic(selected: string, mutate: (topics: Record<string, unknown>[]) => void = () => undefined) {
  const topics = peerTopics() as Record<string, unknown>[];
  mutate(topics);
  const result = parsePeerBoards(peerBody({ topics, top: { own_login: 'me' } }));
  render(
    <MemoryRouter>
      <TopicsPanel
        open
        onClose={vi.fn()}
        peer={peerSourcesOf(result, NOW)[0]!}
        topics={result.peers[0]!.topics}
        selectedTopicId={selected}
        onSelectTopic={vi.fn()}
        nowMs={NOW}
        ownLogin="me"
      />
    </MemoryRouter>,
  );
  return screen.getByRole('region', { name: 'Обсуждение' });
}

beforeEach(() => {
  setLocale('ru');
  resetMissing();
});
afterEach(() => {
  cleanup();
  setLocale('en');
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('TopicTicket', () => {
  it('linked ticket renders «→ задача <id>» as a link to our card on our own topic', () => {
    const pane = renderTopic(OURS, (tp) => {
      tp[1]!.ticket = 'dw-x1';
    });
    const link = within(pane).getByRole('link', { name: '→ задача dw-x1' });
    expect(link.getAttribute('href')).toBe('/beads?bead=dw-x1');
    expect(collectMissing()).toEqual([]);
  });

  it('his topic: the ticket is text only, never a link into our board (N-1)', () => {
    const pane = renderTopic(HIS, (tp) => {
      tp[0]!.ticket = 'dw-x1';
    });
    expect(within(pane).getByText('→ задача dw-x1')).toBeTruthy();
    expect(within(pane).queryByRole('link', { name: /задача/ })).toBeNull();
  });

  // BOARD-LIVE L14: both cities use `dw` ids. The link follows `ticket_ref`
  // (city, rig, id), never the id alone and never who opened the topic.
  it('L14: our ticket on HIS topic links to our card, by ticket_ref', () => {
    const pane = renderTopic(HIS, (tp) => {
      tp[0]!.ticket = 'dw-abc';
      tp[0]!.ticket_ref = { city: 'me', rig: 'devwork', id: 'dw-abc' };
    });
    const link = within(pane).getByRole('link', { name: '→ задача dw-abc' });
    expect(link.getAttribute('href')).toBe('/beads?bead=dw-abc');
  });

  it('L14: his ticket with the same id links to HIS card, never to our dw-abc', () => {
    const pane = renderTopic(OURS, (tp) => {
      tp[1]!.ticket = 'dw-abc';
      tp[1]!.ticket_ref = { city: 'rich', rig: 'devwork', id: 'dw-abc' };
    });
    const link = within(pane).getByRole('link', { name: '→ задача dw-abc' });
    expect(link.getAttribute('href')).toBe(`/beads?${new URLSearchParams({ bead: 'peer:rich:devwork:dw-abc' })}`);
  });

  it('L14: a ticket_ref naming a third city is text only', () => {
    const pane = renderTopic(OURS, (tp) => {
      tp[1]!.ticket = 'dw-abc';
      tp[1]!.ticket_ref = { city: 'olga', rig: 'devwork', id: 'dw-abc' };
    });
    expect(within(pane).getByText('→ задача dw-abc')).toBeTruthy();
    expect(within(pane).queryByRole('link', { name: /задача/ })).toBeNull();
  });

  it('an invalid ticket id shows nothing (N-1)', () => {
    const pane = renderTopic(OURS, (tp) => {
      tp[1]!.ticket = 'dw x/../1';
    });
    expect(within(pane).queryByText(/задача/)).toBeNull();
  });

  it('linked ticket renders «→ задача <id>»; Сделать задачей sends no request to peer-boards', async () => {
    const fetchSpy = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('open', vi.fn());
    const pane = renderTopic(OURS, (tp) => {
      tp[1]!.ticket = 'dw-x1';
      tp[1]!.owner_question = ownerQuestion({ question_id: 'q-ours', topic: `me/${OURS}` });
    });
    expect(within(pane).getByRole('link', { name: '→ задача dw-x1' })).toBeTruthy();
    // «Сделать задачей» is the owner's button on the Mayor's Discord message:
    // here the question only links there, and nothing is posted anywhere.
    expect(within(pane).queryByRole('button', { name: 'Сделать задачей' })).toBeNull();
    await act(async () => {
      fireEvent.click(within(pane).getByRole('link', { name: 'Ответить в Discord' }));
    });
    expect(fetchSpy.mock.calls.filter(([, init]) => (init?.method ?? 'GET') !== 'GET')).toEqual([]);
  });
});
