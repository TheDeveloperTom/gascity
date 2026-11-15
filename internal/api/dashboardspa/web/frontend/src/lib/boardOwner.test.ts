import { describe, expect, it } from 'vitest';
import { DEFAULT_OWNER, ownerChoicesEnabled, useBoardSources } from './boardOwner';

describe('board sources (owner seam)', () => {
  it('defaults to one source owned by me', () => {
    const sources = useBoardSources();
    expect(sources).toHaveLength(1);
    expect(sources[0]?.owner).toBe('me');
    expect(sources[0]?.available).toBe(true);
    expect(DEFAULT_OWNER).toBe('me');
  });

  it('owner choices need two or more available sources', () => {
    expect(ownerChoicesEnabled(useBoardSources())).toBe(false);
    expect(
      ownerChoicesEnabled([
        { owner: 'me', label: 'Mine', available: true },
        { owner: 'richard', label: 'Richard', available: false },
      ]),
    ).toBe(false);
    expect(
      ownerChoicesEnabled([
        { owner: 'me', label: 'Mine', available: true },
        { owner: 'richard', label: 'Richard', available: true },
      ]),
    ).toBe(true);
  });
});
