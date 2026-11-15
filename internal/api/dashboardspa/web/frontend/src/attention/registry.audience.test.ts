import { describe, expect, it } from 'vitest';
import type { AgentResponse, Bead, Message } from 'gas-city-dashboard-shared/gc-supervisor';
import { OWNER_QUESTION_LABEL } from '../lib/ownerQuestions';
import { composeAttention } from './compose';
import { createAttentionContributors, type AttentionContributorFacts } from './registry';

// Dashboard v3: the owner slice holds owner questions only (ownerQuestionOf).
// Mail, agents, stalled and unassigned work belong to the city or nowhere.

const LABEL = OWNER_QUESTION_LABEL;
const NOW = Date.parse('2026-06-01T12:00:00.000Z');

function bead(overrides: Partial<Bead>): Bead {
  return {
    created_at: '2026-05-29T20:00:00.000Z',
    id: 'B-0',
    issue_type: 'task',
    status: 'open',
    title: 'Bead',
    ...overrides,
  };
}

function question(id: string, metadata: Record<string, string> = {}): Bead {
  return bead({
    id,
    title: 'Merge the login change?',
    labels: [LABEL],
    metadata: {
      'decision.question_id': `q-${id}`,
      'owner.link': `https://discord.com/channels/1/2/${id}`,
      ...metadata,
    },
  });
}

function message(overrides: Partial<Message>): Message {
  return {
    body: '',
    created_at: '2026-06-01T11:00:00.000Z',
    from: 'mayor',
    id: 'M-0',
    read: false,
    subject: 'Message',
    to: 'stephanie',
    ...overrides,
  };
}

function agent(overrides: Partial<AgentResponse>): AgentResponse {
  return {
    available: true,
    name: 'agent',
    running: false,
    state: 'active',
    suspended: false,
    pack_derived: false,
    ...overrides,
  };
}

function model(facts: AttentionContributorFacts) {
  return composeAttention(createAttentionContributors(facts));
}

function beadsFacts(extra: Partial<NonNullable<AttentionContributorFacts['beads']>>) {
  return {
    beads: {
      decisionLabel: LABEL,
      operatorAliases: ['stephanie', 'human'],
      nowMs: NOW,
      ...extra,
    },
  };
}

describe('attention audience', () => {
  it('an owner question is owner and links to its Discord message', () => {
    const m = model(
      beadsFacts({
        decisions: [
          question('dw-9', {
            'owner.link': 'https://discord.com/channels/1/2/3',
            'decision.slack_url': 'https://example.slack.com/archives/C1/p1',
          }),
        ],
      }),
    );
    expect(m.owner.items).toHaveLength(1);
    expect(m.owner.items[0]).toMatchObject({
      audience: 'owner',
      ref: 'dw-9',
      externalHref: 'https://discord.com/channels/1/2/3',
    });
  });

  // Coupling (review M5): the decision queue is fetched by the configured
  // label, but an owner question must carry needs/operator. A city that
  // configures another label gets no owner questions until it uses this one.
  it('a configured decision label other than needs/operator yields no owner questions', () => {
    const other = bead({
      id: 'dw-7',
      labels: ['needs/stephanie'],
      metadata: {
        'decision.question_id': 'q-7',
        'owner.link': 'https://discord.com/channels/1/2/7',
      },
    });
    const m = model(beadsFacts({ decisionLabel: 'needs/stephanie', decisions: [other] }));
    expect(m.owner.total).toBe(0);
  });

  it('no link → not owner', () => {
    const m = model(
      beadsFacts({
        decisions: [
          question('dw-9', { 'owner.link': 'javascript:alert(1)' }),
          question('dw-8', { 'owner.link': '' }),
        ],
      }),
    );
    expect(m.owner.total).toBe(0);
    expect(m.owner.items).toEqual([]);
  });

  it('owner total equals owner questions', () => {
    const m = model({
      ...beadsFacts({
        decisions: [question('dw-9'), bead({ id: 'dw-legacy', labels: [LABEL] })],
        items: [
          bead({
            id: 'B-h',
            status: 'in_progress',
            assignee: 'worker',
            metadata: { 'gc.checkpoint_hold': 'design review', 'gc.waiting_on': 'human' },
          }),
        ],
      }),
      mail: { nowMs: NOW, items: [message({ id: 'M-1', from: 'mayor', subject: 'Please look' })] },
      agents: {
        items: [agent({ name: 'mayor', running: true, state: 'active' })],
        pendingInteractions: [
          {
            agentName: 'mayor',
            sessionId: 'gc-1',
            sessionName: 'mayor',
            pending: { kind: 'tool_approval', prompt: 'Approve?', request_id: 'r1' },
          },
        ],
      },
    });
    expect(m.owner.total).toBe(1);
    expect(m.owner.items.map((item) => item.ref)).toEqual(['dw-9']);
    expect(m.city.items.map((item) => item.id)).toContain('beads:dw-legacy:mayor-decision');
    expect(m.city.items.map((item) => item.id)).toContain('beads:B-h:waiting-human');
  });

  it('awaiting-input agent and operator mail are city', () => {
    const m = model({
      mail: {
        nowMs: NOW,
        items: [
          message({ id: 'M-1', from: 'mayor', subject: 'Please look' }),
          message({ id: 'M-2', from: '/home/ds/gascity/polecat-1', subject: 'worker noise' }),
        ],
      },
      agents: {
        items: [
          agent({ name: 'mayor', running: true, state: 'active' }),
          agent({ name: 'crashed', state: 'failed' }),
        ],
        pendingInteractions: [
          {
            agentName: 'mayor',
            sessionId: 'gc-1',
            sessionName: 'mayor',
            pending: { kind: 'tool_approval', prompt: 'Approve?', request_id: 'r1' },
          },
        ],
      },
    });
    expect(m.owner.items).toEqual([]);
    expect(m.city.items.map((item) => item.id)).toEqual(
      expect.arrayContaining(['agents:mayor:needs-you', 'agents:crashed:needs-you']),
    );
    expect(m.city.items.map((item) => item.title)).toContain('Please look');
    expect(m.items.some((item) => item.title === 'worker noise')).toBe(false);
  });

  it('ready-unclaimed rows are not health items', () => {
    const m = model(
      beadsFacts({
        items: [bead({ id: 'B-old', created_at: '2026-05-20T00:00:00.000Z' })],
      }),
    );
    expect(m.items.some((item) => item.id.endsWith(':ready-unclaimed'))).toBe(false);
    expect(m.city.total).toBe(0);
  });

  it('an owner question also in the general list appears once, as owner', () => {
    const decision = { ...question('dw-9'), created_at: '2026-05-20T00:00:00.000Z' };
    const m = model(beadsFacts({ decisions: [decision], items: [decision] }));
    const matching = m.items.filter((item) => item.id.startsWith('beads:dw-9'));
    expect(matching).toHaveLength(1);
    expect(matching[0]?.audience).toBe('owner');
  });
});
