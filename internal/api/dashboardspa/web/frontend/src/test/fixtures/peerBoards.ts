// vk-final: a `/v1/boards` body from the city service `peer-boards`, shaped
// like sync/rigs (27457ed0): board_schema /2, card.rig, the thresholds, and
// fields the dashboard does not read yet (they must pass the schema).

export const PEER_SNAPSHOT_AT = '2026-11-15T18:52:00Z';

export function peerBody(overrides: { snapshotAt?: string; cards?: unknown[] } = {}) {
  const at = overrides.snapshotAt ?? PEER_SNAPSHOT_AT;
  return {
    schema: 'devwork.peer-boards/1',
    heartbeat_seconds: 900,
    stale_after_seconds: 1500,
    failure_backoff_seconds: 900,
    peers: [
      {
        login: 'rich',
        person: { name: 'Ричард', genitive: 'Ричарда', initial: 'Р' },
        city: 'devwork-platform',
        board_schema: 'devwork.board/2',
        rigs: ['crm-api', 'devwork'],
        skipped_rigs: [],
        snapshot_at: at,
        generated_at: at,
        changed_at: '2026-11-15T18:40:00Z',
        fetched_at: at,
        fetch_error: null,
        fetch_failed_at: null,
        dropped_cards: 0,
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
