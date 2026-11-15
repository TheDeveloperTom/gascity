import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Final review Minor 7: a transcript's `system` role label was amber. Amber
// is a state colour (waiting, caution); a role is not a state, so it reads
// in quiet ink like the other non-speaker roles (colour rule §3.4).

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('transcript role tones carry no state colour', () => {
  it('StructuredTranscript system role is not amber', () => {
    const src = read('../components/structured/StructuredTranscript.tsx');
    expect(src).not.toMatch(/system:\s*'text-warn'/);
    expect(src).toMatch(/system:\s*'text-fg-muted'/);
  });

  it('SessionPeek system role is not amber', () => {
    const src = read('../components/SessionPeek.tsx');
    expect(src).not.toMatch(/case 'system':\s*return 'text-warn'/);
  });
});
