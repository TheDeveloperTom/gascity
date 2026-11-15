import { describe, expect, it } from 'vitest';
import { composeAttention, type AttentionContributor, type AttentionItem } from './compose';

function contributor(items: readonly AttentionItem[]): AttentionContributor {
  return { id: 'test', domain: 'beads', getItems: () => items };
}

describe('composeAttention audience slices', () => {
  it('slices', () => {
    const model = composeAttention([
      contributor([
        { id: 'o1', domain: 'mail', severity: 'attention', title: 'Mail', audience: 'owner' },
        { id: 'o2', domain: 'beads', severity: 'watch', title: 'Q', audience: 'owner' },
        { id: 'c1', domain: 'health', severity: 'attention', title: 'Host load high' },
        { id: 'c2', domain: 'beads', severity: 'watch', title: 'X', audience: 'city' },
        { id: 'c3', domain: 'runs', severity: 'unavailable', title: 'Run list incomplete' },
      ]),
    ]);

    expect(model.owner.total).toBe(2);
    expect(model.city.total).toBe(2);
    expect(model.owner.byDomain.mail).toBe(1);
    expect(model.owner.byDomain.beads).toBe(1);
    expect(model.owner.items.map((item) => item.id)).toEqual(['o1', 'o2']);
    // The unavailable item is still in the city list (shown faintly), not counted.
    expect(model.city.items.map((item) => item.id)).toContain('c3');
    expect(model.city.byDomain.runs).toBe(0);
  });

  it('owner unavailable items are listed but not counted', () => {
    const model = composeAttention([
      contributor([
        { id: 'o1', domain: 'mail', severity: 'unavailable', title: 'Mail', audience: 'owner' },
      ]),
    ]);
    expect(model.owner.total).toBe(0);
    expect(model.owner.items).toHaveLength(1);
  });

  it('carries the owner readiness it is given, ready by default', () => {
    expect(composeAttention([]).ownerReadiness).toEqual({ state: 'ready' });
    expect(composeAttention([], { ownerReadiness: { state: 'loading' } }).ownerReadiness).toEqual({
      state: 'loading',
    });
  });
});
