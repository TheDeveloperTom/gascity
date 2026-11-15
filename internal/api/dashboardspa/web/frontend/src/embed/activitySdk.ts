// ACTIVITY-PLAN Task 6 — Discord Embedded App SDK bootstrap.
//
// Runs only inside the Activity (main.tsx checks isEmbedded()). Silent sign-in:
// authorize (identify, prompt "none") → POST /api/activity/token {code,
// instance_id} → authenticate({access_token}) → setAuthHeaders(session). The
// gateway keeps its own copy of the Discord access token server-side; the copy
// it returns here is handed to authenticate() and then dropped: it is never
// stored, logged, or sent as a request header.
//
// SDK pinned exactly @discord/embedded-app-sdk@2.5.0 and bundled (no CDN).

import { DiscordSDK } from '@discord/embedded-app-sdk';
import { setAuthHeaders, withApiBase } from '../lib/apiBase';
import { setExternalOpener } from '../lib/openExternal';
import { captureLaunch, setActivityRole, setReauth, type ActivityRole } from './activitySession';

export { getActivityRole, canWrite } from './activitySession';
export type { ActivityRole } from './activitySession';

/** The gateway refused this Discord user (403 not_allowed). */
export class ActivityNoAccessError extends Error {
  constructor() {
    super('activity: no access');
    this.name = 'ActivityNoAccessError';
  }
}

export interface ActivityIdentity {
  userId: string;
  role: ActivityRole;
}

interface TokenReply {
  session: string;
  access_token: string;
  user_id: string;
  role: ActivityRole;
}

function parseTokenReply(v: unknown): TokenReply {
  if (typeof v !== 'object' || v === null) throw new Error('activity: bad token reply');
  const r = v as Record<string, unknown>;
  if (
    typeof r.session !== 'string' ||
    r.session === '' ||
    typeof r.access_token !== 'string' ||
    typeof r.user_id !== 'string' ||
    (r.role !== 'owner' && r.role !== 'reader')
  ) {
    throw new Error('activity: bad token reply');
  }
  return {
    session: r.session,
    access_token: r.access_token,
    user_id: r.user_id,
    role: r.role,
  };
}

async function signIn(
  sdk: DiscordSDK,
  clientId: string,
  fetchImpl: typeof fetch,
): Promise<ActivityIdentity> {
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
    // Older clients answer INVALID_COMMAND (RES §3); the board needs only
    // the gateway session, so sign-in goes on. The error is not logged: it
    // may echo the request.
  }

  setAuthHeaders({
    Authorization: `Bearer ${reply.session}`,
    'X-Activity-Instance': sdk.instanceId,
  });
  setActivityRole(reply.role);
  return { userId: reply.user_id, role: reply.role };
}

/**
 * Signs the board in to the Activity gateway. Rejects with
 * ActivityNoAccessError on 403; any other failure rejects with a plain Error
 * and leaves the auth headers empty.
 */
export async function bootActivity(
  clientId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ActivityIdentity> {
  const sdk = new DiscordSDK(clientId);
  // vk-final part 5: the Mayor's card link (`custom_id=bead:<id>`), read once.
  captureLaunch(sdk.customId, sdk.instanceId);
  await sdk.ready();
  const who = await signIn(sdk, clientId, fetchImpl);

  setExternalOpener((url) =>
    sdk.commands.openExternalLink({ url }).then(() => undefined),
  );
  setReauth(async () => {
    try {
      await signIn(sdk, clientId, fetchImpl);
    } catch (err) {
      if (err instanceof ActivityNoAccessError) {
        setAuthHeaders({});
        setActivityRole(null);
      }
      throw err;
    }
  });
  return who;
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
  clientId: string | undefined,
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
