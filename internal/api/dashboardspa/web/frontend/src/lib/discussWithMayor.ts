// Seam stub (vk lane 0b). Interface owner: lane 6 in this wave; lane 7 owns the
// implementation bodies later. No other lane edits it.
//
// In the Activity both calls go through the gateway and carry the session
// auth header (Task 6): `POST /api/activity/answer` and
// `POST /api/activity/discuss`, owner only (a reader is refused here, before
// any request, and by the gateway with 403).

import { isEmbedded } from './apiBase';
import { activityPost, canWrite } from '../embed/activitySession';

const DISCORD_CHANNEL_URL = /^https:\/\/discord\.com\/channels\/\d+\/\d+(\/\d+)?$/;

// The gateway's caps (act/write): 400 above them, counted in code points.
const MAX_TITLE = 200;
const MAX_SUMMARY = 1000;

/** At most `max` code points; a cut string ends with «…» inside the cap. */
function clip(text: string, max: number): string {
  const points = [...text];
  return points.length <= max ? text : `${points.slice(0, max - 1).join('')}…`;
}

export interface DiscussContext {
  kind: 'task' | 'need';
  beadId: string;
  title: string;
  summary: string;
}

/** The Mayor's Discord channel, or null when it is not configured (button disabled). */
export function mayorChannelUrl(): string | null {
  const v = import.meta.env.VITE_MAYOR_DISCORD_URL;
  return typeof v === 'string' && v.startsWith('https://discord.com/channels/') ? v : null;
}

/**
 * Hands the Mayor the context and resolves to the Discord URL to open.
 * Inside the Activity: `POST /api/activity/discuss {kind, id, title, summary}`
 * (title ≤ 200, summary ≤ 1000 code points, cut with «…») and the gateway's
 * Discord URL; a 501 (city-side command not ready yet) falls back to the
 * channel link when configured. Outside it: the channel link only.
 */
export async function discussWithMayor(ctx: DiscussContext): Promise<string> {
  if (isEmbedded()) {
    if (!canWrite()) throw new Error('discussWithMayor: owner only');
    const res = await activityPost('/api/activity/discuss', {
      kind: ctx.kind === 'task' ? 'bead' : 'needs',
      id: ctx.beadId,
      title: clip(ctx.title, MAX_TITLE),
      summary: clip(ctx.summary, MAX_SUMMARY),
    });
    if (res.status === 501) {
      const fallback = mayorChannelUrl();
      if (fallback !== null) return fallback;
    }
    if (!res.ok) throw new Error(`discussWithMayor: ${res.status}`);
    const body: unknown = await res.json();
    const url = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).url : undefined;
    if (typeof url !== 'string' || !DISCORD_CHANNEL_URL.test(url)) {
      throw new Error('discussWithMayor: bad url');
    }
    return url;
  }
  const url = mayorChannelUrl();
  if (url === null) throw new Error('mayor channel not configured');
  return url;
}

/**
 * Records the owner's choice on a Mayor question, exactly as the Discord
 * button does (lane 7 / the Activity gateway implement it). It posts ONLY
 * inside the Discord Activity (`isEmbedded()`), where the request carries the
 * session auth header; outside it never posts and rejects «not embedded»
 * (the UI opens the Mayor's Discord message instead). Wired (Task 6):
 * `POST /api/activity/answer {qid, choice}`; owner only; rejects on any
 * non-2xx with AnswerRefusedError (403 not the owner, 409 closed or already
 * answered, 502 an error); answerErrorText() gives the UI text.
 */
export async function answerQuestion(qid: string, choiceIndex: number): Promise<void> {
  if (!isEmbedded()) throw new Error('answerQuestion: not embedded');
  if (!canWrite()) throw new Error('answerQuestion: owner only');
  const res = await activityPost('/api/activity/answer', { qid, choice: choiceIndex });
  if (!res.ok) throw new AnswerRefusedError(res.status);
}

/** The gateway refused an answer; `status` is its HTTP status. */
export class AnswerRefusedError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`answerQuestion: ${status}`);
    this.name = 'AnswerRefusedError';
    this.status = status;
  }
}

/** UI text for a failed answer: 409 «Уже отвечено», 403 «Только владелец», else a generic error. */
export function answerErrorText(err: unknown): string {
  if (err instanceof AnswerRefusedError) {
    if (err.status === 409) return 'Уже отвечено';
    if (err.status === 403) return 'Только владелец';
  }
  if (err instanceof Error && err.message === 'answerQuestion: owner only') return 'Только владелец';
  return 'Не удалось ответить';
}
