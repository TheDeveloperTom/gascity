import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// accent is Stop red and means alarm only (DESIGN-PLAN R3, §3.4). Anything
// you can press, hover or focus uses primary. This walks the shipped source
// (tests and test helpers excluded) and pins that rule.

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(): Array<{ path: string; text: string }> {
  return (readdirSync(srcDir, { recursive: true }) as string[])
    .filter((rel) => /\.(ts|tsx)$/.test(rel))
    .filter((rel) => !/\.test\./.test(rel))
    .filter((rel) => !rel.split(/[\\/]/).includes('test'))
    .map((rel) => ({ path: rel, text: readFileSync(join(srcDir, rel), 'utf8') }));
}

function read(rel: string): string {
  return readFileSync(join(srcDir, rel), 'utf8');
}

const INTERACTIVE_ACCENT = [
  /(?:hover|group-hover|focus|focus-visible|active):[\w/-]*accent\b/g,
  /\bring-accent\b/g,
  /\baccent-fg\b/g,
];

// The one place red may follow the pointer: an attention row's own tint
// deepening on hover in attention/routeHighlight.ts. That is the row's state
// (DESIGN-PLAN §3.4 "attention tints"), not a pressable affordance, and the
// Activity/Health task keeps it (`hover:bg-accent/10`). Only that file and
// only a `hover:bg-accent/<alpha>` tint are exempt.
function isAttentionTint(path: string, match: string): boolean {
  return (
    path.replace(/\\/g, '/') === 'attention/routeHighlight.ts' &&
    /^hover:bg-accent\/[\w.[\]]+$/.test(match)
  );
}

describe('accent is alarm-only', () => {
  it('no interactive state uses accent', () => {
    const hits: string[] = [];
    for (const { path, text } of sourceFiles()) {
      for (const pattern of INTERACTIVE_ACCENT) {
        for (const match of text.matchAll(pattern)) {
          const tail = text.slice(match.index ?? 0).match(/^\S+/)?.[0] ?? match[0];
          if (isAttentionTint(path, tail.replace(/['"`,;]+$/, ''))) continue;
          hits.push(`${path}: ${match[0]}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('only the attention-tint helper is exempt', () => {
    expect(isAttentionTint('attention/routeHighlight.ts', 'hover:bg-accent/15')).toBe(true);
    expect(isAttentionTint('attention/routeHighlight.ts', 'hover:text-accent')).toBe(false);
    expect(isAttentionTint('components/Button.tsx', 'hover:bg-accent/15')).toBe(false);
  });

  it('the primary button is blue', () => {
    expect(read('components/Button.tsx')).toContain('bg-primary text-on-primary');
  });

  it('decorative accents are gone', () => {
    expect(read('components/structured/StructuredTranscript.tsx')).not.toContain(
      "assistant: 'text-accent'",
    );
    expect(read('routes/Health.tsx')).not.toContain('className="text-accent"');
  });
});
