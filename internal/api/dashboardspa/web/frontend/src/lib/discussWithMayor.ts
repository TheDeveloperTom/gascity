// Seam stub (vk lane 0b). Interface owner: lane 6 in this wave; lane 7 owns the
// implementation body later. No other lane edits it.

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
