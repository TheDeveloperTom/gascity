import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThrottledValue } from './useThrottledValue';

describe('useThrottledValue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the first value at once, then at most one new value per window (the latest)', () => {
    const { result, rerender } = renderHook(({ v }) => useThrottledValue(v, 4000), { initialProps: { v: 1 } });
    expect(result.current).toBe(1);
    rerender({ v: 2 });
    rerender({ v: 3 });
    expect(result.current).toBe(1);
    act(() => vi.advanceTimersByTime(3999));
    expect(result.current).toBe(1);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(3);
  });

  it('a value after a quiet window lands at once', () => {
    const { result, rerender } = renderHook(({ v }) => useThrottledValue(v, 4000), { initialProps: { v: 'a' } });
    act(() => vi.advanceTimersByTime(10_000));
    rerender({ v: 'b' });
    expect(result.current).toBe('b');
  });

  it('a new flush key (another read landed) shows the value at once', () => {
    const { result, rerender } = renderHook(({ v, k }) => useThrottledValue(v, 4000, k), {
      initialProps: { v: 'a', k: 'rig' },
    });
    rerender({ v: 'b', k: 'rig' });
    expect(result.current).toBe('a');
    rerender({ v: 'c', k: 'rig+all' });
    expect(result.current).toBe('c');
  });
});
