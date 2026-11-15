import { describe, expect, it } from 'vitest';
import type { AgentResponse, Bead, Message } from 'gas-city-dashboard-shared/gc-supervisor';
import { composeAttention } from './compose';
import { createAttentionContributors, type AttentionContributorFacts } from './registry';

const LABEL = 'needs/stephanie';
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
  it('decision is owner and carries the Slack link', () => {
    const m = model(
      beadsFacts({
        decisions: [
          bead({
            id: 'dw-9',
            title: 'Merge the login change?',
            labels: [LABEL],
            metadata: { 'decision.slack_url': 'https://example.slack.com/archives/C1/p1' },
          }),
        ],
      }),
    );
    expect(m.owner.items).toHaveLength(1);
    expect(m.owner.items[0]).toMatchObject({
      audience: 'owner',
      ref: 'dw-9',
      externalHref: 'https://example.slack.com/archives/C1/p1',
    });
  });

  it('decision accepts a chat_url too', () => {
    const m = model(
      beadsFacts({
        decisions: [
          bead({
            id: 'dw-9',
            labels: [LABEL],
            metadata: { 'decision.chat_url': 'https://discord.com/channels/1/2/3' },
          }),
        ],
      }),
    );
    expect(m.owner.items[0]?.externalHref).toBe('https://discord.com/channels/1/2/3');
  });

  it('decision with a javascript: slack_url has no externalHref', () => {
    const m = model(
      beadsFacts({
        decisions: [
          bead({
            id: 'dw-9',
            labels: [LABEL],
            metadata: { 'decision.slack_url': 'javascript:alert(1)' },
          }),
        ],
      }),
    );
    expect(m.owner.items[0]).not.toHaveProperty('externalHref');
  });

  it('operator mail is owner, pool-worker mail never appears', () => {
    const m = model({
      mail: {
        nowMs: NOW,
        items: [
          message({ id: 'M-1', from: 'mayor', subject: 'Please look' }),
          message({ id: 'M-2', from: '/home/ds/gascity/polecat-1', subject: 'worker noise' }),
        ],
      },
    });
    expect(m.owner.items.map((item) => item.title)).toEqual(['Please look']);
    expect(m.items.some((item) => item.title === 'worker noise')).toBe(false);
  });

  it('awaiting-input agent is owner, errored agent is city', () => {
    const m = model({
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
    expect(m.owner.items.map((item) => item.id)).toEqual(['agents:mayor:needs-you']);
    expect(m.city.items.map((item) => item.id)).toContain('agents:crashed:needs-you');
  });

  it('waiting on human is owner, hold:mayor is city', () => {
    const m = model(
      beadsFacts({
        items: [
          bead({
            id: 'B-h',
            status: 'in_progress',
            assignee: 'worker',
            metadata: { 'gc.checkpoint_hold': 'design review', 'gc.waiting_on': 'human' },
          }),
          bead({
            id: 'B-m',
            status: 'in_progress',
            assignee: 'worker',
            labels: ['hold:mayor'],
          }),
        ],
      }),
    );
    expect(m.owner.items.map((item) => item.id)).toEqual(['beads:B-h:waiting-human']);
    expect(m.city.items.map((item) => item.id)).toContain('beads:B-m:waiting-human');
  });

  it('a decision bead also in the general list appears once, as owner', () => {
    const decision = bead({ id: 'dw-9', labels: [LABEL], created_at: '2026-05-20T00:00:00.000Z' });
    const m = model(beadsFacts({ decisions: [decision], items: [decision] }));
    const matching = m.items.filter((item) => item.id.startsWith('beads:dw-9'));
    expect(matching).toHaveLength(1);
    expect(matching[0]?.audience).toBe('owner');
  });
});
