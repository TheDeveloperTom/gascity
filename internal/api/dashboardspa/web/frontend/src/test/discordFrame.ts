// Test helper: put the page where Discord puts an Activity, or back.
// Discord serves the Activity from `https://<application_id>.discordsays.com`
// with `frame_id`/`instance_id` in the query; jsdom's own reconfigure moves
// the document there (a real origin change, as in the iframe).

import { resetEmbedForTests } from '../embed/mode';
import { resetSupervisorApiForTests } from '../supervisor/client';

export const APP_ID = '1571490006042939402';
export const DISCORD_ORIGIN = `https://${APP_ID}.discordsays.com`;
export const PLAIN_ORIGIN = 'http://127.0.0.1';

interface JsdomHandle {
  reconfigure(opts: { url: string }): void;
}

function jsdom(): JsdomHandle {
  return (globalThis as unknown as { jsdom: JsdomHandle }).jsdom;
}

/** Moves the document to `url` and forgets every latched mode and cached client. */
export function moveTo(url: string): void {
  jsdom().reconfigure({ url });
  resetEmbedForTests();
  resetSupervisorApiForTests();
}

/** Inside the Activity: the proxy origin with the SDK launch params. */
export function enterDiscordFrame(path = '/city/test-city/beads', instanceId = 'inst-1'): void {
  const u = new URL(path, DISCORD_ORIGIN);
  u.searchParams.set('frame_id', 'frame-1');
  u.searchParams.set('instance_id', instanceId);
  u.searchParams.set('platform', 'mobile');
  moveTo(u.toString());
}

/** The plain web app (the vitest default origin). */
export function leaveDiscordFrame(): void {
  moveTo(`${PLAIN_ORIGIN}/`);
}
