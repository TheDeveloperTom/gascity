// While the city restarts, every read answers «not_found: city not found or
// not running: <city>» (or the city reports it is starting). The owner sees
// one calm line instead of a stack of red alerts; any other error stays.

const NOT_RUNNING = /city not found or not running/iu;
const STARTING = /\bcity\b.*\bis starting\b/iu;

export function isCityRestartingError(message: string): boolean {
  return NOT_RUNNING.test(message) || STARTING.test(message);
}

export function splitCityRestarting(messages: ReadonlyArray<string | null | undefined>): {
  restarting: boolean;
  rest: string[];
} {
  const lines = messages.filter((m): m is string => typeof m === 'string' && m.trim() !== '');
  const rest = lines.filter((m) => !isCityRestartingError(m));
  return { restarting: rest.length !== lines.length, rest };
}
