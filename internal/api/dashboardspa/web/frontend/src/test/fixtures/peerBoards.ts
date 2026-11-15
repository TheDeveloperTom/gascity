// vk-final: a `/v1/boards` body from the city service `peer-boards`, shaped
// like sync/rigs (27457ed0): board_schema /2, card.rig, the thresholds, and
// fields the dashboard does not read yet (they must pass the schema).

export const PEER_SNAPSHOT_AT = '2026-11-15T18:52:00Z';

/** A card thread (COMMENTS-PLAN Revision 2: author objects, our delivery state). */
export function peerThread() {
  return {
    rig: 'crm-api',
    card: 'dw-ab12',
    peer: 'rich',
    comments: [
      {
        id: 'bd-1',
        mine: false,
        author: { kind: 'mayor', city: 'rich', name: 'mayor' },
        text: 'Взял в работу, начинаю с миграции схемы.',
        created_at: '2026-11-15T18:20:00Z',
        state: null,
        reason: null,
      },
      {
        id: 'xc-00000000000000000001',
        mine: true,
        author: { kind: 'person', city: 'me', name: 'Артём' },
        text: 'Ты тут собираешься менять схему users — давай согласуем',
        created_at: '2026-11-15T18:40:00Z',
        state: 'delivered',
        reason: null,
      },
      {
        id: 'bd-2',
        mine: false,
        author: { kind: 'person', city: 'rich', name: 'Ричард' },
        text: 'Ок, подожду',
        created_at: '2026-11-15T18:51:00Z',
        state: null,
        reason: null,
      },
      {
        id: 'bd-3',
        mine: false,
        author: { kind: 'person', city: 'rich', name: 'Ричард' },
        text: 'напиши, как вольёшь',
        created_at: '2026-11-15T18:51:30Z',
        state: null,
        reason: null,
      },
      {
        id: 'bd-4',
        mine: false,
        author: { kind: 'agent', city: 'rich', name: 'deputy', agent: 'deputy' },
        text: 'Тесты схемы зелёные',
        created_at: '2026-11-15T18:52:00Z',
        state: null,
        reason: null,
      },
      {
        id: 'xc-00000000000000000002',
        mine: true,
        author: 'Артём',
        text: 'Спасибо, напишу сразу, как волью',
        created_at: '2026-11-15T18:53:00Z',
        state: 'queued',
        reason: null,
      },
    ],
  };
}

const RICH_MAYOR = { kind: 'mayor', city: 'rich', name: 'mayor' };
const MY_MAYOR = { kind: 'mayor', city: 'me', name: 'mayor' };

/**
 * Authors with their Discord identity (owner 15.11): `display_name` and an
 * `avatar_url` served by OUR city service from its local cache (same
 * origin; the browser never loads cdn.discordapp.com).
 */
export const AVATAR_BASE = '/v0/city/test-city/svc/peer-boards/v1/avatars';
export const RICH_MAYOR_DISCORD = {
  ...RICH_MAYOR,
  display_name: 'Richard’s Mayor',
  avatar_url: `${AVATAR_BASE}/111111111111111111.png`,
};
export const RICHARD_DISCORD = {
  kind: 'person',
  city: 'rich',
  name: 'Ричард',
  display_name: 'richard.dev',
  avatar_url: `${AVATAR_BASE}/222222222222222222.png`,
};
export const DEPUTY_DISCORD = {
  kind: 'agent',
  city: 'rich',
  name: 'deputy',
  agent: 'deputy',
  display_name: 'Deputy',
  avatar_url: `${AVATAR_BASE}/333333333333333333.webp`,
};

/**
 * Topics in the city's final dashboard contract (topics-report.md «Final
 * dashboard contract»): one open with unread, one paused by the rails
 * (needs_human), one paused by a person, one resolved.
 */
export function peerTopics() {
  return [
    {
      topic_id: 'tp-aaaaaaaaaaaaaaaaaaaa',
      city: 'rich',
      peer: 'me',
      mine: false,
      title: 'Перезагрузка общего CI в 22:00',
      status: 'open',
      paused_reason: null,
      // a card conversation is a Mayor topic linked to that card (owner, 15.11)
      card: { city: 'rich', rig: 'crm-api', id: 'dw-ab12' },
      last_activity_at: '2026-11-15T18:40:00Z',
      duplicate_resolutions: [],
      opened_by: RICH_MAYOR,
      opened_at: '2026-11-15T18:35:00Z',
      opened_because: { kind: 'owner_request', message_id: 'm-0' },
      resolution: null,
      ticket: null,
      unread_count: 1,
      reactions: [{ message_id: 'm-1', kind: 'ack', by: MY_MAYOR, at: '2026-11-15T18:36:30Z', mine: true }],
      messages: [
        {
          id: 'm-1',
          kind: 'open',
          author: RICH_MAYOR,
          text: 'Ричард хочет в 22:00 перезагрузить общий CI. Вашему городу подходит?',
          summary: 'Можно ли в 22:00 перезагрузить CI?',
          created_at: '2026-11-15T18:35:00Z',
          mine: false,
          state: null,
          reason: null,
          reopened: false,
          needs_owner_decision: true,
        },
        {
          id: 'm-2',
          kind: 'message',
          author: MY_MAYOR,
          text: 'Уточняю у Артёма.',
          summary: 'Уточняю у Артёма',
          created_at: '2026-11-15T18:40:00Z',
          mine: true,
          state: 'delivered',
          reason: null,
          reopened: false,
          needs_owner_decision: false,
        },
      ],
    },
    {
      topic_id: 'tp-bbbbbbbbbbbbbbbbbbbb',
      city: 'me',
      peer: 'rich',
      mine: true,
      title: 'Кто обновляет Node 24',
      status: 'paused',
      paused_reason: 'needs_human',
      // a topic about one of OUR cards
      card: { city: 'me', rig: 'devwork', id: 'dw-ab12' },
      last_activity_at: '2026-11-15T17:00:00Z',
      opened_by: MY_MAYOR,
      opened_at: '2026-11-15T17:00:00Z',
      resolution: null,
      unread_count: 0,
      messages: [
        { id: 'n-1', kind: 'open', author: MY_MAYOR, text: 'Кто обновит Node?', summary: 'Кто обновит Node?', created_at: '2026-11-15T17:00:00Z', mine: true, state: 'delivered' },
      ],
    },
    {
      topic_id: 'tp-dddddddddddddddddddd',
      city: 'me',
      peer: 'rich',
      mine: true,
      title: 'Ночная сборка',
      status: 'paused',
      paused_reason: 'human',
      last_activity_at: '2026-11-15T16:00:00Z',
      opened_by: { kind: 'person', city: 'me', name: 'Артём' },
      opened_at: '2026-11-15T16:00:00Z',
      resolution: null,
      unread_count: 0,
      messages: [
        { id: 'd-1', kind: 'open', author: { kind: 'person', city: 'me', name: 'Артём' }, text: 'Подождём до утра.', summary: 'Подождём до утра', created_at: '2026-11-15T16:00:00Z', mine: true, state: 'delivered' },
      ],
    },
    {
      topic_id: 'tp-cccccccccccccccccccc',
      city: 'rich',
      peer: 'me',
      mine: false,
      title: 'Ключ Clerk',
      status: 'resolved',
      paused_reason: null,
      opened_by: RICH_MAYOR,
      opened_at: '2026-11-14T10:00:00Z',
      resolution: {
        reason: 'resolved',
        by: { kind: 'person', city: 'rich', name: 'Ричард' },
        at: '2026-11-14T11:00:00Z',
        deciding_message_id: 'c-2',
        summary: 'договорились, решено без задачи',
      },
      unread_count: 0,
      messages: [
        { id: 'c-1', author: RICH_MAYOR, text: 'Чей ключ Clerk?', created_at: '2026-11-14T10:00:00Z', state: null },
        { id: 'c-2', author: { kind: 'person', city: 'rich', name: 'Ричард' }, text: 'Мой, оставляем.', created_at: '2026-11-14T10:30:00Z', state: null },
      ],
    },
  ];
}

/**
 * BOARD-LIVE L10 `owner_q.question_views` row (C3): one plain owner question
 * about a topic; our city service computes it from OUR files.
 */
export const QUESTION_LINE_1 = 'Мэры договорились: общий конфиг сборки меняет Ричард.';
export const QUESTION_LINE_2 = 'У нас изменится: наша задача подождёт его изменения.';
export const QUESTION_JUMP = 'https://discord.com/channels/111/222/333';
export function ownerQuestion(over: Record<string, unknown> = {}) {
  return {
    question_id: 'q-7f3a9c',
    text: `${QUESTION_LINE_1}\n${QUESTION_LINE_2}`,
    options: ['Да', 'Нет', 'Обсудить', 'Сделать задачей'],
    status: 'pending',
    answer: null,
    topic: 'rich/tp-aaaaaaaaaaaaaaaaaaaa',
    card: null,
    jump_url: QUESTION_JUMP,
    ...over,
  };
}

export function peerBody(
  overrides: {
    snapshotAt?: string;
    cards?: unknown[];
    threads?: unknown[];
    topics?: unknown[];
    /** BOARD-LIVE C4 `live` block of the peer (absent = an old peer). */
    live?: unknown;
    people?: unknown[];
    fetchedAt?: string;
    /** Top-level additions (own_login, owner_questions …). */
    top?: Record<string, unknown>;
  } = {},
) {
  const at = overrides.snapshotAt ?? PEER_SNAPSHOT_AT;
  return {
    ...(overrides.top ?? {}),
    schema: 'devwork.peer-boards/1',
    heartbeat_seconds: 900,
    stale_after_seconds: 1500,
    failure_backoff_seconds: 900,
    peers: [
      {
        login: 'rich',
        person: { name: 'Ричард', genitive: 'Ричарда', initial: 'Р', dative: 'Ричарду' },
        city: 'devwork-platform',
        board_schema: 'devwork.board/2',
        rigs: ['crm-api', 'devwork'],
        skipped_rigs: [],
        snapshot_at: at,
        generated_at: at,
        changed_at: '2026-11-15T18:40:00Z',
        fetched_at: overrides.fetchedAt ?? at,
        ...(overrides.live === undefined ? {} : { live: overrides.live }),
        ...(overrides.people === undefined ? {} : { people: overrides.people }),
        fetch_error: null,
        fetch_failed_at: null,
        dropped_cards: 0,
        threads: overrides.threads ?? [],
        topics: overrides.topics ?? [],
        cards: overrides.cards ?? [
          {
            id: 'dw-ab12',
            title: 'Изменение схемы users',
            status: 'in_progress',
            issue_type: 'task',
            priority: 2,
            labels: ['needs/operator'],
            parent: null,
            created_at: '2026-11-14T10:00:00Z',
            updated_at: '2026-11-15T18:40:00Z',
            closed_at: null,
            description: 'Схема users меняется.',
            metadata: { 'devwork.pr_number': '12' },
            rig: 'crm-api',
            some_future_field: { nested: true },
          },
        ],
      },
    ],
  };
}
