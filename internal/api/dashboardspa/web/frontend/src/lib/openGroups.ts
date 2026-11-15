import { readBrowserStorage, writeBrowserStorage } from './browserStorage';

// Open Waiting groups, remembered per viewer (RB4, G-04). Keys are data
// (`milestone:M04`), so a locale switch keeps a group open. A blocked or
// broken storage reads as "nothing open" and never throws.

export const OPEN_GROUPS_STORAGE_KEY = 'gcd:board:openGroups';
const COMPONENT = 'board';

export function readOpenGroups(): Set<string> {
  const read = readBrowserStorage('localStorage', OPEN_GROUPS_STORAGE_KEY, COMPONENT);
  if (read.status !== 'found') return new Set();
  try {
    const parsed: unknown = JSON.parse(read.value);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((key): key is string => typeof key === 'string'));
  } catch {
    return new Set();
  }
}

export function writeOpenGroups(keys: ReadonlySet<string>): void {
  writeBrowserStorage(
    'localStorage',
    OPEN_GROUPS_STORAGE_KEY,
    JSON.stringify([...keys]),
    COMPONENT,
  );
}
