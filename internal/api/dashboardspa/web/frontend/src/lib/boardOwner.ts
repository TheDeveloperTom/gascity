// The ONE seam for «Мои / Ричарда» (vk lane 4, owner). Other lanes import it.

export type CardOwner = 'me' | 'richard';
export type OwnerFilter = 'all' | CardOwner;
export const DEFAULT_OWNER: CardOwner = 'me';

/** One board source. The sync lane adds { owner: 'richard', available: true } — nothing else changes. */
export interface BoardSource {
  owner: CardOwner;
  label: string;
  available: boolean;
}

const SOURCES: readonly BoardSource[] = [{ owner: 'me', label: 'Mine', available: true }];

export function useBoardSources(): readonly BoardSource[] {
  return SOURCES;
}

/** «Мои» and «Ричарда» only mean something once two or more sources answer. */
export function ownerChoicesEnabled(sources: readonly BoardSource[]): boolean {
  return sources.filter((s) => s.available).length >= 2;
}
