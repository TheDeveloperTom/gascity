import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('joins truthy class names and drops the rest', () => {
    expect(cn('a', false, 'b', null, undefined, '', 'c')).toBe('a b c');
  });

  it('is empty with no classes', () => {
    expect(cn()).toBe('');
  });
});
