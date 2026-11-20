import { describe, expect, it } from 'vitest';
import type { AgentResponse, Bead, Message } from 'gas-city-dashboard-shared/gc-supervisor';
import { setLocale } from '../i18n';
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

// DIAG 20.11: an owner question is an open human gate with a posted question
// (lib/ownerQuestions ownerDebtOf); the label rides along for the decision queue.
function question(id: string, metadata: Record<string, string> = {}): Bead {
  return bead({
    id,
    issue_type: 'gate',
    title: 'Merge the login change?',
    labels: [LABEL],
    metadata: {
      'gc.gate_type': 'human',
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

  // Review of fork #6, B1/B2: the owner plate reads the same rule and index as
  // the board — a plain-card question counts, and a card behind an open answer
  // gate is the owner's through that gate (ref = the gate, counted once).
  it('a plain-card question is owner; a card behind an answer gate is owner via the gate', () => {
    const card = (id: string): Bead => ({ ...question(id), issue_type: 'task' });
    const plain = model(beadsFacts({ decisions: [card('dw-c1')] }));
    expect(plain.owner.items.map((i) => [i.audience, i.ref])).toEqual([['owner', 'dw-c1']]);

    const gated = model(
      beadsFacts({
        decisions: [card('dw-c2')],
        serviceItems: [
          bead({
            id: 'dw-ag2',
            issue_type: 'gate',
            await_type: 'human',
            metadata: { 'devwork.gate_kind': 'answer', 'devwork.answer_for': 'dw-c2' },
          }),
        ],
      }),
    );
    expect(gated.owner.items.map((i) => [i.audience, i.ref])).toEqual([['owner', 'dw-ag2']]);
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

  // Review C1: an unknown hold names no actor, so it is city work, not the owner's.
  it.each(['hold:plan', 'hold:coordinator', 'hold:prereq'])(
    '%s stays out of the owner slice',
    (label) => {
      const m = model(
        beadsFacts({
          items: [
            bead({
              id: 'B-p',
              status: 'open',
              labels: [label],
              updated_at: '2026-06-01T07:00:00Z',
            }),
          ],
        }),
      );
      expect(m.owner.total).toBe(0);
      expect(m.owner.items).toEqual([]);
      expect(m.city.items.map((item) => item.id)).toContain('beads:B-p:waiting-human');
    },
  );

  it('a checkpoint hold with no named actor stays out of the owner slice', () => {
    const m = model(
      beadsFacts({
        items: [
          bead({
            id: 'B-c',
            status: 'in_progress',
            assignee: 'w',
            metadata: { 'gc.checkpoint_hold': 'design' },
          }),
        ],
      }),
    );
    expect(m.owner.total).toBe(0);
  });

  // v3: the owner slice holds owner questions only, so a bead that names the
  // owner stays the city's; its copy still says it waits on you (review N1).
  it.each([
    [
      'gc.waiting_on=<operator alias>',
      { metadata: { 'gc.checkpoint_hold': 'x', 'gc.waiting_on': 'stephanie' } },
    ],
    ['gc.checkpoint=awaiting-human', { metadata: { 'gc.checkpoint': 'awaiting-human' } }],
    ['hold:human', { labels: ['hold:human'] }],
    ['hold:<operator alias>', { labels: ['hold:stephanie'] }],
  ] as const)('%s is city work that reads as waiting on you', (_name, extra) => {
    const m = model(
      beadsFacts({
        items: [
          bead({
            id: 'B-o',
            status: 'in_progress',
            assignee: 'w',
            updated_at: '2026-06-01T07:00:00.000Z',
            ...(extra as Partial<Bead>),
          }),
        ],
      }),
    );
    expect(m.owner.items).toEqual([]);
    const row = m.city.items.find((item) => item.id === 'beads:B-o:waiting-human');
    expect(row?.summary).toBe('Waiting on you for 5 hours');
  });

  it('an owner wait reads «Ждёт вас» in Russian', () => {
    setLocale('ru');
    try {
      const m = model(
        beadsFacts({
          items: [
            bead({
              id: 'B-o',
              status: 'in_progress',
              assignee: 'w',
              updated_at: '2026-06-01T07:00:00.000Z',
              metadata: { 'gc.checkpoint_hold': 'x', 'gc.waiting_on': 'human' },
            }),
          ],
        }),
      );
      const row = m.city.items.find((item) => item.id === 'beads:B-o:waiting-human');
      expect(row?.summary).toBe('Ждёт вас уже 5 часов');
    } finally {
      setLocale('en');
    }
  });

  // Review I4: every city example stays out of owner.items.
  it('city sources never reach the owner slice', () => {
    const m = composeAttention(
      createAttentionContributors({
        beads: {
          decisionLabel: LABEL,
          operatorAliases: ['stephanie', 'human'],
          nowMs: NOW,
          sessions: [],
          items: [bead({ id: 'gcg-153601', status: 'in_progress', title: 'stalled' })],
          escalations: [bead({ id: 'B-e', status: 'open', labels: ['gc:escalation'] })],
        },
        activity: {
          events: [
            {
              actor: 's',
              seq: 1,
              subject: 'x',
              ts: '2026-06-01T11:00:00Z',
              type: 'session.crashed',
            } as never,
          ],
        },
        runs: {
          summary: {
            totalActive: 0,
            totalHistorical: 0,
            historicalLanes: [],
            lanes: [],
            blockedLanes: [],
            recentChanges: [],
            runCounts: {
              total: 0,
              visible: 0,
              prReview: 0,
              designReview: 0,
              bugfix: 0,
              blocked: 0,
              other: 0,
            },
            census: { status: 'unavailable', error: 'n/a' },
          } as never,
          error: 'runs down',
        },
        health: { supervisor: { status: 'unavailable', error: 'down' } },
        agents: { items: [agent({ name: 'crashed', state: 'failed' })] },
      }),
    );
    expect(m.owner.items).toEqual([]);
    const cityIds = m.city.items.map((item) => item.id);
    for (const id of [
      'beads:gcg-153601:stalled',
      'beads:B-e:escalated',
      'activity:event:1:session.crashed',
      'runs:unavailable',
      'health:supervisor-unreachable',
      'agents:crashed:needs-you',
    ]) {
      expect(cityIds).toContain(id);
    }
  });

  it.each([
    ['decision.chat_url', 'javascript:alert(1)'],
    ['decision.chat_url', 'http://example.com/x'],
    ['decision.slack_url', 'http://example.com/x'],
  ])('a %s of %s has no externalHref', (key, value) => {
    const m = model(
      beadsFacts({
        decisions: [bead({ id: 'dw-9', labels: [LABEL], metadata: { [key]: value } })],
      }),
    );
    const row = m.items.find((item) => item.ref === 'dw-9');
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('externalHref');
  });

  it('an owner question also in the general list appears once, as owner', () => {
    const decision = { ...question('dw-9'), created_at: '2026-05-20T00:00:00.000Z' };
    const m = model(beadsFacts({ decisions: [decision], items: [decision] }));
    const matching = m.items.filter((item) => item.id.startsWith('beads:dw-9'));
    expect(matching).toHaveLength(1);
    expect(matching[0]?.audience).toBe('owner');
  });
});
