// Seam stub (vk lane 0b). Owner: lane 4 (the ONE seam for «Мои / Ричарда»).
// Other lanes import, never edit.

export type CardOwner = 'me' | 'richard';
export type OwnerFilter = 'all' | CardOwner;
export const DEFAULT_OWNER: CardOwner = 'me';

/** One board source. The sync lane adds { owner: 'richard', available: true } — nothing else changes. */
export interface BoardSource {
  owner: CardOwner;
  label: string;
  available: boolean;
}

export function useBoardSources(): readonly BoardSource[] {
  return [{ owner: 'me', label: 'Mine', available: true }];
}
