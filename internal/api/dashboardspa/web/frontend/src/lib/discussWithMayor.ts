// Seam stub (vk lane 0b). Interface owner: lane 6 in this wave; lane 7 owns the
// implementation bodies later. No other lane edits it.
//
// In the Activity both calls go through the gateway and carry the session
// auth header: lane 7 / Task 6 send `authHeaders()` (lib/apiBase) and pick the
// `/api/activity/*` route when `isEmbedded()`.

import { isEmbedded } from './apiBase';

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

/** Hands the Mayor the context (lane 7) and resolves to the Discord URL to open. Stub: channel link only. */
export async function discussWithMayor(_ctx: DiscussContext): Promise<string> {
  const url = mayorChannelUrl();
  if (url === null) throw new Error('mayor channel not configured');
  return url;
}

/**
 * Records the owner's choice on a Mayor question, exactly as the Discord
 * button does (lane 7 / the Activity gateway implement it). It posts ONLY
 * inside the Discord Activity (`isEmbedded()`), where the request carries the
 * session auth header; outside it never posts and rejects «not embedded»
 * (the UI opens the Mayor's Discord message instead). Stub: not wired.
 */
export async function answerQuestion(_qid: string, _choiceIndex: number): Promise<void> {
  if (!isEmbedded()) throw new Error('answerQuestion: not embedded');
  throw new Error('answerQuestion: not wired');
}
