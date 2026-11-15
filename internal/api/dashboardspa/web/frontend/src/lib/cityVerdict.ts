import { t, tn } from '../i18n';

// One verdict about the city (dashboard v3, ruling V9): a sentence for
// Главная, three rows for Здоровье, and the problems that drive the menu
// badge. Board staleness is never an input, so a stale card can never become
// a city problem.

export interface CityInputs {
  nowMs: number;
  /** Last successful supervisor read. */
  lastStatusOkMs: number | null;
  /** Last supervisor read that timed out. */
  lastStatusTimeoutMs: number | null;
  /** Last answer of the cheap health probe. */
  lastHealthProbeOkMs: number | null;
  /** When this dashboard started watching (no verdict of «down» before 60 s). */
  startedAtMs: number | null;
  host: { cpuCount: number; load1: number; memFreeBytes: number; memTotalBytes: number } | null;
  store: 'ok' | 'overdue' | 'failed' | null;
  quarantined: number;
  mayorRunningSinceMs: number | null;
  mayorDownSinceMs: number | null;
}

export interface CityVerdict {
  sentence: string;
  supervisor: 'ok' | 'slow' | 'down';
  rows: { city: string; mac: string; store: string };
  problems: readonly { key: string; line: string; href: string }[];
}

export const SUPERVISOR_OK_WINDOW_MS = 60_000;
export const SUPERVISOR_SLOW_PROBE_WINDOW_MS = 120_000;
export const MAYOR_DOWN_PROBLEM_MS = 5 * 60_000;
const OVERLOAD_RATIO = 2;
const LOW_MEMORY_SHARE = 0.1;

function within(nowMs: number, atMs: number | null, windowMs: number): boolean {
  return atMs !== null && nowMs - atMs < windowMs;
}

/** Local wall-clock «ЧЧ:ММ». */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function supervisorState(input: CityInputs): {
  state: CityVerdict['supervisor'];
  sinceMs: number | null;
} {
  const { nowMs } = input;
  if (within(nowMs, input.lastStatusOkMs, SUPERVISOR_OK_WINDOW_MS))
    return { state: 'ok', sinceMs: null };
  if (
    input.lastStatusTimeoutMs !== null &&
    within(nowMs, input.lastHealthProbeOkMs, SUPERVISOR_SLOW_PROBE_WINDOW_MS)
  ) {
    return { state: 'slow', sinceMs: null };
  }
  const answers = [input.lastStatusOkMs, input.lastHealthProbeOkMs].filter(
    (v): v is number => v !== null,
  );
  const lastAnswer = answers.length > 0 ? Math.max(...answers) : null;
  if (within(nowMs, lastAnswer, SUPERVISOR_OK_WINDOW_MS)) return { state: 'ok', sinceMs: null };
  if (lastAnswer === null && within(nowMs, input.startedAtMs, SUPERVISOR_OK_WINDOW_MS)) {
    return { state: 'ok', sinceMs: null };
  }
  return { state: 'down', sinceMs: lastAnswer ?? input.startedAtMs };
}

export function cityVerdict(input: CityInputs): CityVerdict {
  const { state, sinceMs } = supervisorState(input);
  const problems: { key: string; line: string; href: string }[] = [];

  let cityRow: string;
  let sentence: string;
  if (state === 'down') {
    const at = sinceMs === null ? null : clockTime(sinceMs);
    cityRow = at === null ? t('not answering') : t('not answering since {time}', { time: at });
    const line =
      at === null
        ? t('The city is not answering')
        : t('The city is not answering since {time}', { time: at });
    sentence = `${line}.`;
    problems.push({ key: 'down', line, href: '/health' });
  } else {
    cityRow = state === 'slow' ? t('answering slowly') : t('working');
    sentence = t('The city is working.');
  }

  const host = input.host;
  const overloaded =
    host !== null && host.cpuCount > 0 && host.load1 >= OVERLOAD_RATIO * host.cpuCount;
  const freeShare =
    host !== null && host.memTotalBytes > 0 ? host.memFreeBytes / host.memTotalBytes : null;
  const lowMemory = freeShare !== null && freeShare < LOW_MEMORY_SHARE;

  let macRow: string;
  const clauses: string[] = [];
  if (host === null) {
    macRow = t('no data');
  } else if (overloaded) {
    const load = Math.round(host.load1);
    const cores = tn(host.cpuCount, { one: '{n} core', other: '{n} cores' });
    macRow = t('overloaded: load {load} on {cores}', { load, cores });
    const line = t('Mac is overloaded: load {load} on {cores}', { load, cores });
    clauses.push(t('{line}, some data cannot be read in time.', { line }));
    problems.push({ key: 'mac-overloaded', line, href: '/health' });
  } else if (lowMemory) {
    const pct = Math.round((freeShare ?? 0) * 100);
    macRow = t('low memory: {pct}% free', { pct });
    clauses.push(t('Mac is low on memory: {pct}% free.', { pct }));
  } else {
    macRow = t('normal');
  }
  if (overloaded && lowMemory) {
    clauses.push(
      t('Mac is low on memory: {pct}% free.', { pct: Math.round((freeShare ?? 0) * 100) }),
    );
  }

  if (state === 'slow' && clauses.length === 0)
    sentence = t('The city is working, but answering slowly.');
  if (clauses.length > 0) sentence = `${sentence} ${clauses.join(' ')}`;

  let storeRow: string;
  switch (input.store) {
    case 'ok':
      storeRow = t('in order');
      break;
    case 'overdue':
      storeRow = t('maintenance is overdue');
      break;
    case 'failed':
      storeRow = t('maintenance failed');
      problems.push({
        key: 'store-failed',
        line: t('Maintenance of the task store failed'),
        href: '/health',
      });
      break;
    case null:
      storeRow = t('no data');
  }

  if (input.quarantined > 0) {
    problems.push({
      key: 'quarantined',
      line: tn(input.quarantined, {
        one: '{n} agent is quarantined',
        other: '{n} agents are quarantined',
      }),
      href: '/agents',
    });
  }

  if (
    input.mayorRunningSinceMs === null &&
    input.mayorDownSinceMs !== null &&
    input.nowMs - input.mayorDownSinceMs >= MAYOR_DOWN_PROBLEM_MS
  ) {
    problems.push({
      key: 'mayor-down',
      line: t('The Mayor is not running since {time}', { time: clockTime(input.mayorDownSinceMs) }),
      href: '/agents/mayor',
    });
  }

  return {
    sentence,
    supervisor: state,
    rows: { city: cityRow, mac: macRow, store: storeRow },
    problems,
  };
}
