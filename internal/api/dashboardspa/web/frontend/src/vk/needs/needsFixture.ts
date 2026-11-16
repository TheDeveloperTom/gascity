import type { AttentionItem } from '../../attention/compose';
import type { BoardData } from '../../lib/boardModel';
import type { SupervisorBead } from '../../supervisor/beadReads';

// One local fixture for the «Нужно от меня» tests (lane 3): a Mayor question
// that 22 tasks wait on (M04 10, M03 4, 8 with no stage), a second question
// that nobody waits on, a marked question with no Discord link, an
// unassigned blocker of a current-milestone card, and two cards at work.

export const NOW_MS = Date.parse('2026-11-15T16:46:00Z');
const OLD = '2026-11-12T08:00:00Z';

function bead(id: string, extra: Partial<SupervisorBead> = {}): SupervisorBead {
  return { id, title: id, status: 'open', issue_type: 'task', created_at: OLD, ...extra };
}

const blocks = (issue: string, target: string) => ({
  issue_id: issue,
  depends_on_id: target,
  type: 'blocks',
});

export const QUESTION_ID = 'dw-ssmbcp';
export const SECOND_QUESTION_ID = 'dw-m01q';
export const UNLINKED_ID = 'dw-nolink';
export const BLOCKER_ID = 'dw-vv6';

const QUESTION = bead(QUESTION_ID, {
  issue_type: 'gate',
  title: 'M03 #2 / L1: перенос ящика',
  labels: ['needs/operator'],
  metadata: {
    'decision.question_id': 'q-1',
    'decision.decide': 'Когда окно для переноса ящика на основной аккаунт?',
    'decision.why': 'Gmail, доступ и собеседования переедут на твой основной аккаунт.',
    'decision.choices_json': JSON.stringify([
      { label: 'Сегодня в 18:00', then: '' },
      { label: 'Завтра в 10:00', then: '' },
    ]),
    'owner.link': 'https://discord.com/channels/1/2/3',
    // 3 d 8 h before NOW_MS.
    'decision.asked_at': '2026-11-12T08:46:00Z',
  },
});

const SECOND_QUESTION = bead(SECOND_QUESTION_ID, {
  title: 'Считать ли ветку интеграции M01 закрытой',
  labels: ['needs/operator'],
  metadata: {
    'decision.question_id': 'q-2',
    'owner.link': 'https://discord.com/channels/1/2/4',
    'decision.asked_at': '2026-11-15T14:42:00Z',
  },
});

const UNLINKED = bead(UNLINKED_ID, {
  title: 'Вопрос без ссылки',
  labels: ['needs/operator'],
  metadata: { 'decision.question_id': 'q-3' },
});

// 10 M04 + 4 M03 + 8 unstaged tasks wait on the question, some through others.
function waiters(): SupervisorBead[] {
  const out: SupervisorBead[] = [];
  const add = (id: string, milestone: string | null, on: string) =>
    out.push(
      bead(id, {
        title: id,
        is_blocked: true,
        ...(milestone === null ? {} : { labels: [`milestone:${milestone}`] }),
        dependencies: [blocks(id, on)],
      }),
    );
  for (let i = 0; i < 10; i += 1) add(`dw-m04-${i}`, 'M04', QUESTION_ID);
  for (let i = 0; i < 4; i += 1) add(`dw-m03-${i}`, 'M03', QUESTION_ID);
  for (let i = 0; i < 8; i += 1) add(`dw-x-${i}`, null, 'dw-m03-0');
  // «От тебя» holds an open task (lib/ownerAsked): the second question holds one.
  add('dw-m01-close', 'M01', SECOND_QUESTION_ID);
  return out;
}

// An unassigned blocker that an in-flight M04 card waits on.
const BLOCKER = bead(BLOCKER_ID, { title: 'ВВ-6: способ оплаты клиентом' });

const WORKING = bead('dw-580', {
  title: 'Сделать invalidation при изменении вакансии',
  status: 'in_progress',
  assignee: 'devwork/polecat-1',
  labels: ['milestone:M04'],
  updated_at: '2026-11-15T16:45:00Z',
  dependencies: [blocks('dw-580', BLOCKER_ID)],
});

// Owner attention items as the registry makes them: a mail ask, the
// attention copy of QUESTION (dropped: the board lists it), and an
// unreadable source (never a need).
export const OWNER_ITEMS: readonly AttentionItem[] = [
  {
    id: 'mail:M-1:unread',
    domain: 'mail',
    severity: 'attention',
    audience: 'owner',
    title: 'Нужен доступ к Supabase',
    summary: 'Мэру нужен ключ сервиса',
    href: '/mail?message=M-1',
    updatedAt: '2026-11-15T12:46:00Z',
  },
  {
    id: `beads:${QUESTION_ID}:mayor-decision`,
    domain: 'beads',
    severity: 'attention',
    audience: 'owner',
    ref: QUESTION_ID,
    title: 'M03 #2 / L1: перенос ящика',
    href: `/beads?bead=${QUESTION_ID}`,
  },
  {
    id: 'mail:unavailable',
    domain: 'mail',
    severity: 'unavailable',
    audience: 'owner',
    title: 'Mail data unavailable',
  },
];

export const STALLED_ID = 'dw-489';

// A card at work with no progress for 20 h.
const STALLED = bead(STALLED_ID, {
  title: 'Миграция 0425',
  status: 'in_progress',
  assignee: 'devwork/polecat-2',
  updated_at: '2026-11-14T20:46:00Z',
});

export const HELD_STALL_ID = 'dw-held';

// polish2 16.11: an unassigned card that waits on the question (so nobody CAN
// take it) and that a current-milestone card waits on: a stall the question
// already explains.
export function needsBoardWithHeldStall(): BoardData {
  const base = needsBoard();
  const held = bead(HELD_STALL_ID, {
    title: 'Удалить mp_assignment после переноса ящика',
    is_blocked: true,
    dependencies: [blocks(HELD_STALL_ID, QUESTION_ID)],
  });
  const waiter = bead('dw-held-w', {
    title: 'dw-held-w',
    is_blocked: true,
    labels: ['milestone:M04'],
    dependencies: [blocks('dw-held-w', HELD_STALL_ID)],
  });
  return { ...base, items: [...base.items, held, waiter] };
}

export function needsBoard(): BoardData {
  return {
    items: [SECOND_QUESTION, UNLINKED, BLOCKER, WORKING, STALLED, ...waiters()],
    routeItems: [],
    serviceItems: [QUESTION],
    routesComplete: true,
  };
}
