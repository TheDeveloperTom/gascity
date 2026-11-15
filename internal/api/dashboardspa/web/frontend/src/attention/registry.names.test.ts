import { describe, expect, it } from 'vitest';
import type {
  AgentResponse,
  Bead,
  TypedEventStreamEnvelope,
} from 'gas-city-dashboard-shared/gc-supervisor';
import { composeAttention } from './compose';
import { createAttentionContributors } from './registry';

const NOW = Date.parse('2026-06-05T12:00:00.000Z');

function bead(overrides: Partial<Bead>): Bead {
  return {
    created_at: '2026-06-01T12:00:00.000Z',
    id: 'B-0',
    issue_type: 'task',
    status: 'open',
    title: 'Bead',
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

function seeded() {
  return composeAttention(
    createAttentionContributors({
      beads: {
        decisionLabel: 'needs/x',
        nowMs: NOW,
        items: [bead({ id: 'dw-42', title: 'Вход по ссылке' })],
      },
      agents: {
        items: [agent({ name: 'superpowers__implementer-gcg-session-d1b5', state: 'failed' })],
      },
      activity: {
        events: [
          {
            actor: 'supervisor',
            seq: 7,
            subject: 'gc-1',
            ts: '2026-06-05T11:00:00.000Z',
            type: 'session.stranded',
          } as TypedEventStreamEnvelope,
        ],
      },
    }),
  );
}

describe('registry names', () => {
  it('bead item title is the bead title and ref the id', () => {
    const item = seeded().items.find((entry) => entry.id === 'beads:dw-42:ready-unclaimed');
    expect(item).toMatchObject({ title: 'Вход по ссылке', ref: 'dw-42' });
  });

  it('event item title says what happened', () => {
    const item = seeded().items.find((entry) => entry.domain === 'activity');
    expect(item).toMatchObject({
      title: 'An agent session ended and left work behind',
      ref: 'session.stranded',
    });
  });

  it('agent item title names the role', () => {
    const item = seeded().items.find((entry) => entry.domain === 'agents');
    expect(item?.title).toBe('Implementer errored');
  });

  it('no item title starts with an id', () => {
    for (const item of seeded().items) {
      expect(item.title).not.toMatch(/^[a-z]{1,8}-[0-9a-z]+(\s|$)/i);
      expect(item.title).not.toMatch(/^[a-z]+\.[a-z_.]+$/);
    }
  });
});
