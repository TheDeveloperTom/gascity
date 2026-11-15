// ACTIVITY-PLAN Task 6 — open Mayor questions read from the gateway
// (`GET /api/activity/questions`, readers). The gateway keeps expired records,
// so the board drops any question whose `expires_at` is already past. An
// empty or unparseable `expires_at` is kept: the bridge refuses an expired
// answer itself (409).

import { authHeaders, withApiBase } from '../lib/apiBase';
import { fetchWithSessionRetry } from './activitySession';

export interface ActivityQuestion {
  qid: string;
  question: string;
  choices: string[];
  card: string;
  expires_at: string;
  jump_url: string;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function parseQuestion(v: unknown): ActivityQuestion | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.qid !== 'string' || r.qid === '') return null;
  return {
    qid: r.qid,
    question: str(r.question),
    choices: Array.isArray(r.choices) ? r.choices.filter((c): c is string => typeof c === 'string') : [],
    card: str(r.card),
    expires_at: str(r.expires_at),
    jump_url: str(r.jump_url),
  };
}

/** True when `expiresAt` parses and is at or before `nowMs`. */
export function isExpired(expiresAt: string, nowMs: number): boolean {
  if (expiresAt === '') return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t <= nowMs;
}

/** Open questions from the gateway, expired ones dropped. Rejects on non-2xx. */
export async function fetchOpenQuestions(nowMs: number = Date.now()): Promise<ActivityQuestion[]> {
  const res = await fetchWithSessionRetry(() =>
    fetch(withApiBase('/api/activity/questions'), {
      method: 'GET',
      headers: { ...authHeaders(), Accept: 'application/json' },
      credentials: 'same-origin',
    }),
  );
  if (!res.ok) throw new Error(`activity questions: ${res.status}`);
  const body: unknown = await res.json();
  if (!Array.isArray(body)) return [];
  return body
    .map(parseQuestion)
    .filter((q): q is ActivityQuestion => q !== null && !isExpired(q.expires_at, nowMs));
}
