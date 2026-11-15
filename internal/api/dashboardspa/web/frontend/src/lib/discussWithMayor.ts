// «Обсудить с Мэром» / «Обсудить в Discord» (owner 16.11): the dashboard is
// a plain web app, so a discussion opens the owner's Mayor channel (#мэр) in
// Discord; nothing is posted from here. The link is lib/mayorLink's runtime
// value from the city, else the build-time fallback.

import { mayorChannelUrl } from './mayorLink';

export { mayorChannelUrl } from './mayorLink';

export interface DiscussContext {
  kind: 'task' | 'need';
  beadId: string;
  title: string;
  summary: string;
}

/** The Mayor channel to open for this discussion; rejects when none is known. */
export function discussWithMayor(_ctx: DiscussContext): Promise<string> {
  const url = mayorChannelUrl();
  return url === null ? Promise.reject(new Error('mayor channel not configured')) : Promise.resolve(url);
}
