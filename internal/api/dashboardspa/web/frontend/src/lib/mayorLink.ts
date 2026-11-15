// The owner's Mayor channel in Discord (#мэр): where «Обсудить с Мэром» /
// «Обсудить в Discord» go. Owner 16.11: the link comes at RUNTIME from the
// city (`mayor_url` on our own peer-boards `/v1/boards`, read by
// usePeerBoards), so one dashboard build serves every city with no rebuild.
// `VITE_MAYOR_DISCORD_URL` is only the fallback for a city that does not send it.

const CHANNEL_URL = /^https:\/\/(?:discord\.com|discordapp\.com)\/channels\/\d+\/\d+(?:\/\d+)?$/;

let fromCity: string | null = null;

/** A Discord channel or message URL, else null. */
export function discordChannelOrNull(raw: unknown): string | null {
  return typeof raw === 'string' && CHANNEL_URL.test(raw.trim()) ? raw.trim() : null;
}

/** Set from our city service's `mayor_url` on every boards read (null clears). */
export function setCityMayorUrl(raw: unknown): void {
  fromCity = discordChannelOrNull(raw);
}

/** The Mayor channel: the city's runtime link, else the build-time one, else null. */
export function mayorChannelUrl(): string | null {
  if (fromCity !== null) return fromCity;
  return discordChannelOrNull(import.meta.env.VITE_MAYOR_DISCORD_URL);
}

/** Test-only. */
export function resetMayorLinkForTests(): void {
  fromCity = null;
}
