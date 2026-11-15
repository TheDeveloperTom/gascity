import { describe, expect, it } from 'vitest';
import { transitiveWaiters } from './holds';

const index = (entries: Record<string, string[]>): ReadonlyMap<string, readonly string[]> =>
  new Map(Object.entries(entries));

describe('transitiveWaiters', () => {
  it('walks a chain: A←B←C gives B and C for A', () => {
    expect(transitiveWaiters('A', index({ A: ['B'], B: ['C'] }))).toEqual(['B', 'C']);
  });

  it('terminates on a cycle and never counts the task itself', () => {
    expect(transitiveWaiters('A', index({ A: ['B'], B: ['A'] }))).toEqual(['B']);
  });

  it('does not duplicate diamond waiters', () => {
    const waiters = transitiveWaiters('A', index({ A: ['B', 'C'], B: ['D'], C: ['D'] }));
    expect(waiters).toEqual(['B', 'C', 'D']);
  });

  it('is empty for a task nobody waits on', () => {
    expect(transitiveWaiters('A', index({}))).toEqual([]);
  });
});
