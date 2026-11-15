import { describe, expect, it } from 'vitest';
import { attentionBlockProps, attentionRowProps, attentionSectionProps } from './routeHighlight';

// Signal & Pavement attention tints (DESIGN-PLAN §3.4, Task 10). A section in
// trouble gets a signal-coloured panel border; rows get a light signal tint
// that deepens a step on hover. The data attribute stays for tooling.

describe('attentionSectionProps', () => {
  it('borders an attention section in stop red', () => {
    expect(attentionSectionProps('attention')).toEqual({
      'data-attention-severity': 'attention',
      className: 'border-accent/60',
    });
  });

  it('borders a watch section in lamp amber', () => {
    expect(attentionSectionProps('watch')).toEqual({
      'data-attention-severity': 'watch',
      className: 'border-warn/60',
    });
  });

  it('adds nothing when nothing needs you', () => {
    expect(attentionSectionProps(null)).toEqual({});
  });
});

describe('attention row tint', () => {
  it('tints attention rows lightly in red', () => {
    expect(attentionRowProps('attention').className).toBe('bg-accent/[0.07] hover:bg-accent/10');
  });

  it('tints watch rows lightly in amber', () => {
    expect(attentionBlockProps('watch').className).toBe('bg-warn/[0.08] hover:bg-warn/[0.12]');
  });
});
