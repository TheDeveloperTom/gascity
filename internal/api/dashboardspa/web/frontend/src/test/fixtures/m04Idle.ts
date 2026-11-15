import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';

// Live-shaped beads of 15.11 10:27Z (OWNER-HOME-PLAN B3 «Fixture m04Idle»):
// the M04 run drains 18 tasks and waits behind a cross-store gate on
// dw-4xn4b; a second task waits on the decision gate dw-ssmbcp. Ids and
// metadata keys are verbatim from the live city.

function bead(id: string, extra: Partial<Bead> = {}): Bead {
  return {
    id,
    title: id,
    status: 'open',
    issue_type: 'task',
    created_at: '2026-11-14T18:49:00Z',
    ...extra,
  };
}

const blocks = (issue: string, target: string) => ({
  issue_id: issue,
  depends_on_id: target,
  type: 'blocks',
});

export const M04_RUN_ROOT = bead('gcg-153601', {
  status: 'in_progress',
  title: 'devwork-implementation',
  metadata: {
    'gc.kind': 'workflow',
    'gc.formula_name': 'devwork-implementation',
    'gc.root_store_ref': 'rig:devwork',
  },
});

export const M04_DRAIN = bead('gcg-153603', {
  title: 'drain',
  is_blocked: true,
  metadata: {
    'gc.kind': 'drain',
    'gc.root_bead_id': 'gcg-153601',
    'gc.drain_count': '18',
  },
});

function itemRoot(id: string, member: string): Bead {
  return bead(id, {
    title: 'devwork-development',
    is_blocked: true,
    metadata: {
      'gc.kind': 'workflow',
      'gc.drain_control_id': 'gcg-153603',
      'gc.drain_member_id': member,
      'gc.root_store_ref': 'rig:devwork',
    },
  });
}

export const M04_ITEM_ROOTS = [
  itemRoot('gcg-156725', 'dw-209eb9641d6ce042'),
  itemRoot('gcg-156751', 'dw-37352d0f782d1d17'),
  itemRoot('gcg-157167', 'dw-iy9a'),
];

export const M04_GATE = bead('gcg-xsg-2212cab1108e', {
  issue_type: 'gate',
  title: 'cross-store gate',
  labels: ['gc:cross-store-gate'],
  metadata: {
    'gc.cross_store_blocker': 'dw-4xn4b',
    'gc.cross_store_gate_owner': 'gcg-153603',
    'gc.root_bead_id': 'gcg-153601',
  },
});

export const M04_STEPS = [
  bead('gcg-156726', {
    title: 'prepare-worktree',
    is_blocked: true,
    metadata: { 'gc.root_bead_id': 'gcg-156725' },
    dependencies: [blocks('gcg-156726', 'gcg-xsg-2212cab1108e')],
  }),
  bead('gcg-156752', {
    title: 'prepare-worktree',
    is_blocked: true,
    metadata: { 'gc.root_bead_id': 'gcg-156751' },
    dependencies: [blocks('gcg-156752', 'gcg-xsg-2212cab1108e')],
  }),
];

export const M04_MEMBERS = [
  bead('dw-209eb9641d6ce042', {
    title: 'M04 #2 — До использования form_facts в отсеве разделить…',
    labels: ['milestone:M04'],
    is_blocked: true,
  }),
  bead('dw-37352d0f782d1d17', {
    title: 'M04 #3 — Сделать invalidation при изменении вакансии…',
    labels: ['milestone:M04'],
    is_blocked: true,
  }),
  bead('dw-iy9a', {
    title: 'M04 — приёмка этапа (проверяемые пункты §5 L186)',
    labels: ['milestone:M04'],
    is_blocked: true,
  }),
];

export const M04_BLOCKER = bead('dw-4xn4b', {
  title: 'Пакет этапа M04: исполнимый план по мастер-плану §4/§7',
  labels: ['milestone:M04'],
});

export const DECISION_GATE = bead('dw-ssmbcp', {
  issue_type: 'gate',
  title: 'M03 #2 / L1: перенос ящика на основной аккаунт и 0424 — когда окно?',
});

export const DECISION_WAITER = bead('dw-eba63b7db1e9a14e.2', {
  title:
    'M03 #2 / Task 6: допуск, enqueue и claim по собственному ящику пользователя, без mp_assignment',
  is_blocked: true,
  dependencies: [blocks('dw-eba63b7db1e9a14e.2', 'dw-ssmbcp')],
});

export interface M04IdleInput {
  tasks: Bead[];
  routeItems: Bead[];
  serviceItems: Bead[];
  routesComplete: boolean;
}

/** A fresh copy each call, so a test may edit its beads freely. */
export function m04Idle(): M04IdleInput {
  const copy = <T>(value: T): T => structuredClone(value);
  return {
    tasks: copy([...M04_MEMBERS, M04_BLOCKER, DECISION_WAITER]),
    routeItems: copy([M04_RUN_ROOT, M04_DRAIN, ...M04_ITEM_ROOTS, M04_GATE, ...M04_STEPS]),
    serviceItems: copy([DECISION_GATE]),
    routesComplete: true,
  };
}
