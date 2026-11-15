import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskStages } from '../../hooks/useTaskStages';
import { collectMissing, resetMissing, setLocale } from '../../i18n';
import { peerSourcesOf } from '../../lib/boardOwner';
import { resetMayorLinkForTests, setCityMayorUrl } from '../../lib/mayorLink';
import type { NeedsModel } from '../../lib/needsFromMe';
import { topicsForCard } from '../../lib/peerTopics';
import { peerNeedsCount, pendingTopicQuestions, questionsForCard } from '../../lib/topicQuestions';
import { parsePeerBoards, type PeerBoardsResult } from '../../supervisor/peerBoardReads';
import {
  ownerQuestion,
  peerBody,
  peerTopics,
  QUESTION_JUMP,
  QUESTION_LINE_1,
  QUESTION_LINE_2,
} from '../../test/fixtures/peerBoards';
import { CardConversation } from '../comments/CardConversation';
import { NeedsShelves } from './Shelf';

// BOARD-LIVE L10/L7, owner Q-B: one plain owner question shows in three
// views — counted in «Нужно от меня», on the card drawer (ours and the
// peer's), and as a link to its Discord message. Owner 16.11 (no Activity):
// the owner answers in Discord, so every view has only «Ответить в
// Discord». Answering there clears all three on the next boards read.

const STAGES: TaskStages = { state: 'ready', inFlight: [], queued: 0, outsideWindow: 0 };
const EMPTY: NeedsModel = { state: 'ready', needs: [], stalls: [], quiet: [], count: 0 };
const NOW = Date.parse('2026-11-15T19:00:00Z');
const OUR_CARD = { city: 'me', rig: 'devwork', id: 'dw-ab12' };

function boards(status: 'pending' | 'answered' = 'pending'): PeerBoardsResult {
  const topics = peerTopics();
  // his topic about his card, our question on it (topic.owner_question)
  (topics[0] as Record<string, unknown>).owner_question = ownerQuestion({ status });
  return parsePeerBoards(
    peerBody({
      topics,
      top: {
        own_login: 'me',
        owner_questions: [
          ownerQuestion({ status }),
          // a question about OUR card (owner ask --topic … --bead)
          ownerQuestion({ question_id: 'q-ours', topic: 'me/tp-bbbbbbbbbbbbbbbbbbbb', card: OUR_CARD, status }),
        ],
      },
    }),
  );
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
  resetMayorLinkForTests();
});

function renderShelves(result: PeerBoardsResult, model: NeedsModel = EMPTY) {
  const questions = pendingTopicQuestions(result, new Set());
  render(
    <MemoryRouter>
      <NeedsShelves model={model} stages={STAGES} topicQuestions={questions} peerCount={peerNeedsCount(result, new Set(), NOW)} />
    </MemoryRouter>,
  );
}

function renderCard(result: PeerBoardsResult, card: { city: string; rig: string; id: string }, ours: boolean) {
  const ref = { mine: ours, ...card };
  const peers = peerSourcesOf(result, NOW);
  render(
    <MemoryRouter>
      <CardConversation
        topics={topicsForCard(result, ref)}
        questions={questionsForCard(result, ref)}
        peers={peers}
        card={{ ...card, title: 'x' }}
        ours={ours}
        nowMs={NOW}
        onOpenTopic={vi.fn()}
      >
        {({ thread }) => <div data-testid="drawer">{thread}</div>}
      </CardConversation>
    </MemoryRouter>,
  );
  return screen.getByTestId('drawer');
}

describe('one owner question, three views', () => {
  it('pending owner_question shows in Нужно от меня (counted), on the card drawer (ours and peer’s) and links to Discord', () => {
    const result = boards();
    // counted once each (the topic copy and the top-level copy are one question)
    expect(peerNeedsCount(result, new Set(), NOW)).toBe(2);
    // the paused needs_human topic that already has a question is not counted twice
    expect(pendingTopicQuestions(result, new Set()).map((q) => q.question.questionId)).toEqual(['q-7f3a9c', 'q-ours']);

    renderShelves(result);
    const shelf = screen.getByRole('button', { name: /Нужно от меня/ });
    expect(shelf.textContent).toContain('2');
    const items = screen.getAllByTestId('topic-question');
    expect(items).toHaveLength(2);
    const link = within(items[0]!).getByRole('link', { name: 'Ответить в Discord' });
    expect(link.getAttribute('href')).toBe(QUESTION_JUMP);
    expect(collectMissing()).toEqual([]);
    cleanup();

    // his card drawer: the question on his topic about that card
    const his = renderCard(result, { city: 'rich', rig: 'crm-api', id: 'dw-ab12' }, false);
    expect(within(his).getAllByTestId('topic-question')).toHaveLength(1);
    expect(within(his).getByText(QUESTION_LINE_1)).toBeTruthy();
    cleanup();

    // our card drawer: the question with card = our card
    const ours = renderCard(result, OUR_CARD, true);
    const q = within(ours).getByTestId('topic-question');
    expect(q.getAttribute('data-question')).toBe('q-ours');
    expect(within(q).getByRole('link', { name: 'Ответить в Discord' }).getAttribute('href')).toBe(QUESTION_JUMP);
  });

  it('a question our bead already lists (same question id) is not counted again', () => {
    const result = boards();
    expect(peerNeedsCount(result, new Set(['q-ours']), NOW)).toBe(1);
    expect(pendingTopicQuestions(result, new Set(['q-ours']))).toHaveLength(1);
  });

  it('the owner answers in Discord: only «Ответить в Discord», no answer buttons, nothing posted', () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderShelves(boards());
    const item = screen.getAllByTestId('topic-question')[0]!;
    expect(within(item).queryAllByRole('button')).toHaveLength(0);
    const link = within(item).getByRole('link', { name: 'Ответить в Discord' });
    fireEvent.click(link);
    expect(open).toHaveBeenCalledWith(QUESTION_JUMP, '_blank', 'noopener,noreferrer');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(collectMissing()).toEqual([]);
  });

  it('with no message link, «Ответить в Discord» goes to the owner’s Mayor channel', () => {
    setCityMayorUrl('https://discord.com/channels/111/999');
    const result = parsePeerBoards(
      peerBody({ top: { own_login: 'me', owner_questions: [ownerQuestion({ jump_url: null })] } }),
    );
    renderShelves(result);
    const link = within(screen.getByTestId('topic-question')).getByRole('link', { name: 'Ответить в Discord' });
    expect(link.getAttribute('href')).toBe('https://discord.com/channels/111/999');
  });

  it('after answered all three views clear on the next boards refresh', () => {
    const result = boards('answered');
    expect(peerNeedsCount(result, new Set(), NOW)).toBe(0);
    renderShelves(result);
    expect(screen.queryAllByTestId('topic-question')).toHaveLength(0);
    cleanup();
    expect(within(renderCard(result, OUR_CARD, true)).queryAllByTestId('topic-question')).toHaveLength(0);
    cleanup();
    expect(
      within(renderCard(result, { city: 'rich', rig: 'crm-api', id: 'dw-ab12' }, false)).queryAllByTestId('topic-question'),
    ).toHaveLength(0);
  });

  it('question text renders as the two plain lines only, no ids', () => {
    renderShelves(boards());
    const item = screen.getAllByTestId('topic-question')[0]!;
    const lines = within(item).getAllByTestId('question-line').map((p) => p.textContent);
    expect(lines).toEqual([QUESTION_LINE_1, QUESTION_LINE_2]);
    const text = item.textContent ?? '';
    expect(text).not.toContain('q-7f3a9c');
    expect(text).not.toContain('tp-');
    expect(text).not.toContain('rich/');
    expect(text).not.toContain('dw-');
  });
});
