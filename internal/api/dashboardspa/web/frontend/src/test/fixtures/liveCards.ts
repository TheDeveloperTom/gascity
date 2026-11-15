import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';

// Live cards of 15.11 (mockups-v3/snapshot/beads-open.json), ids, titles,
// times and metadata keys verbatim; long metadata values are shortened and
// keys the dashboard never reads are left out. The task dw-mqfcx.13 carries
// no PR key of its own: PR #489 lives on its land bead dw-7lpzg7
// (`pr_number`, linked back by `land_source`, and from the task by
// `devwork.land_bead`). No live bead says a PR is a draft.

export const LIVE_MQFCX13: Bead = {
  id: 'dw-mqfcx.13',
  title:
    'dw-mqfcx.5 часть 2: миграция 0425 (удаление столбцов слепых вакансий); production — по слову владельца',
  status: 'open',
  issue_type: 'task',
  priority: 3,
  created_at: '2026-11-12T12:14:34Z',
  updated_at: '2026-11-12T16:28:56Z',
  parent: 'dw-mqfcx',
  is_blocked: false,
  metadata: {
    'devwork.land_bead': 'dw-7lpzg7',
    'devwork.land_set_aside_by': 'dw-7lpzg7',
    'devwork.land_state':
      'set aside: CI is red on https://github.com/TheDeveloperTom/career-ops-platform/pull/489 at 5ed3e028cc0c4cde27f5eb5fc4b56eb4d429a33b (Tests); nothing merged, the PR stays open',
    'devwork.review_verdict': 'pass',
    'devwork.task_branch': 'devwork/task/dw-mqfcx.13',
    target: 'main',
  },
  dependencies: [{ issue_id: 'dw-mqfcx.13', depends_on_id: 'dw-mqfcx', type: 'parent-child' }],
};

export const LIVE_7LPZG7: Bead = {
  id: 'dw-7lpzg7',
  title:
    'Land dw-mqfcx.5 часть 2: миграция 0425 (удаление столбцов слепых вакансий); production — по слову владельца (devwork/task/dw-mqfcx.13 -> main)',
  status: 'open',
  issue_type: 'task',
  priority: 1,
  created_at: '2026-11-12T16:13:29Z',
  updated_at: '2026-11-12T16:28:55Z',
  is_blocked: false,
  metadata: {
    branch: 'devwork/task/dw-mqfcx.13',
    'devwork.land_step': 'ci',
    land_source: 'dw-mqfcx.13',
    merge_result: 'pull_request',
    merge_strategy: 'pr',
    pr_number: '489',
    pr_url: 'https://github.com/TheDeveloperTom/career-ops-platform/pull/489',
    target: 'main',
  },
};

export const LIVE_59WD5S: Bead = {
  id: 'dw-59wd5s',
  title:
    'Land M03 #2 / Task 6: допуск, enqueue и claim по собственному ящику пользователя, без mp_assignment (devwork/task/dw-eba63b7db1e9a14e.2 -> main)',
  status: 'open',
  issue_type: 'task',
  priority: 1,
  created_at: '2026-11-12T07:21:13Z',
  updated_at: '2026-11-12T07:32:49Z',
  is_blocked: false,
  metadata: {
    branch: 'devwork/task/dw-eba63b7db1e9a14e.2',
    land_source: 'dw-eba63b7db1e9a14e.2',
    merge_result: 'pull_request',
    pr_number: '475',
    pr_url: 'https://github.com/TheDeveloperTom/career-ops-platform/pull/475',
    target: 'main',
  },
};
