// Discord mode: the Embedded App SDK boot (restored from a03453e1f^
// embed/activitySdk.ts; read-only v1, DESIGN-discord-activity-return §4.2).
//
// The SDK's documented flow, nothing of our own in between:
//   new DiscordSDK(client_id) → ready() → authorize({response_type:'code',
//   prompt:'none', scope:['identify']}) → our gateway POST /api/activity/token
//   {code, instance_id} (the client secret stays server-side) →
//   authenticate({access_token}).
// The access token must reach the page because authenticate() runs in the
// iframe. It is handed to authenticate() and the reference dropped: never
// stored (no web storage, no cookie), never in a URL, never
// logged, never sent back. The gateway's own HMAC session is the only
// credential the board sends.
//
// This module is loaded only through main.tsx's dynamic import inside the
// isEmbedded() branch, so the SDK is its own chunk and the plain web path
// never fetches it. Pinned exactly @discord/embedded-app-sdk@2.5.0, bundled
// (the Activity CSP allows no CDN).

import { DiscordSDK } from '@discord/embedded-app-sdk';
import { withApiBase } from '../lib/apiBase';
import { setExternalOpener } from '../lib/openExternal';
import { setAuthHeaders, setTailscaleBoardUrl } from './mode';
import { setReauth } from './session';

/** The gateway refused this Discord user (403: not the owner). */
export class ActivityNoAccessError extends Error {
  constructor() {
    super('activity: no access');
    this.name = 'ActivityNoAccessError';
  }
}

interface TokenReply {
  session: string;
  access_token: string;
  user_id: string;
  board_url: unknown;
}

function parseTokenReply(v: unknown): TokenReply {
  if (typeof v !== 'object' || v === null) throw new Error('activity: bad token reply');
  const r = v as Record<string, unknown>;
  if (
    typeof r.session !== 'string' ||
    r.session === '' ||
    typeof r.access_token !== 'string' ||
    typeof r.user_id !== 'string'
  ) {
    throw new Error('activity: bad token reply');
  }
  return {
    session: r.session,
    access_token: r.access_token,
    user_id: r.user_id,
    board_url: r.board_url,
  };
}

async function signIn(sdk: DiscordSDK, clientId: string, fetchImpl: typeof fetch): Promise<string> {
  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify'],
  });

  const res = await fetchImpl(withApiBase('/api/activity/token'), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ code, instance_id: sdk.instanceId }),
  });
  if (res.status === 403) throw new ActivityNoAccessError();
  if (!res.ok) throw new Error(`activity: token exchange ${res.status}`);
  const reply = parseTokenReply(await res.json());

  try {
    await sdk.commands.authenticate({ access_token: reply.access_token });
  } catch {
    // Older clients answer INVALID_COMMAND; the board needs only the gateway
    // session. Not logged: the error may echo the request.
  }

  setAuthHeaders({
    Authorization: `Bearer ${reply.session}`,
    'X-Activity-Instance': sdk.instanceId,
  });
  setTailscaleBoardUrl(reply.board_url);
  return reply.user_id;
}

/**
 * Signs the board in to the Activity gateway. Rejects with
 * ActivityNoAccessError on 403; any other failure rejects with a plain Error
 * and leaves the auth headers empty.
 */
export async function bootActivity(
  clientId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const sdk = new DiscordSDK(clientId);
  await sdk.ready();
  const userId = await signIn(sdk, clientId, fetchImpl);

  // Links leave through Discord's own «open external link» prompt: a plain
  // window.open or target=_blank is blocked or breaks out of the frame.
  setExternalOpener((url) => sdk.commands.openExternalLink({ url }).then(() => undefined));
  setReauth(async () => {
    try {
      await signIn(sdk, clientId, fetchImpl);
    } catch (err) {
      if (err instanceof ActivityNoAccessError) setAuthHeaders({});
      throw err;
    }
  });
  return userId;
}

function renderMessage(root: HTMLElement, text: string): void {
  const p = document.createElement('p');
  p.className = 'p-6 text-body';
  p.textContent = text;
  root.replaceChildren(p);
}

/**
 * main.tsx entry: boots the Activity, or renders «Нет доступа» (403) or a
 * sign-in error into `root` and returns false so the board is not mounted.
 */
export async function runActivityBoot(
  clientId: string | null,
  root: HTMLElement,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const id = (clientId ?? '').trim();
  if (id === '') {
    renderMessage(root, 'Не удалось войти через Discord');
    return false;
  }
  try {
    await bootActivity(id, fetchImpl);
    return true;
  } catch (err) {
    renderMessage(
      root,
      err instanceof ActivityNoAccessError ? 'Нет доступа' : 'Не удалось войти через Discord',
    );
    return false;
  }
}
