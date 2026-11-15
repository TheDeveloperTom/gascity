import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Ruling R5 (DESIGN-PLAN §4): sentence case everywhere, no letter-spaced
// labels, no italic notes. Word shapes carry a second-language reader; caps
// and slants take them away. This walks every routed .tsx file (tests, test
// helpers and the unrouted ambient home excluded) with comments stripped.

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const UNROUTED = new Set(['routes/AmbientHome.tsx', 'attention/AttentionSummaryPanel.tsx']);

function routedTsxFiles(): Array<{ path: string; text: string }> {
  return (readdirSync(srcDir, { recursive: true }) as string[])
    .map((rel) => rel.replace(/\\/g, '/'))
    .filter((rel) => rel.endsWith('.tsx'))
    .filter((rel) => !/\.test\./.test(rel))
    .filter((rel) => !rel.split('/').includes('test'))
    .filter((rel) => !rel.startsWith('components/ambient/'))
    .filter((rel) => !UNROUTED.has(rel))
    .map((rel) => ({ path: rel, text: readFileSync(join(srcDir, rel), 'utf8') }));
}

// Block comments first (they may contain `//`), keeping their newlines so hit
// line numbers stay true. Then line comments. A `//` preceded by `:` is a URL
// inside a string, not a comment.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const FORBIDDEN: ReadonlyArray<[string, RegExp]> = [
  ['uppercase', /\buppercase\b/g],
  ['tracking-wider/widest', /\btracking-wid(?:er|est)\b/g],
  ['italic', /\bitalic\b/g],
];

describe('type rules (R5)', () => {
  it('strips comments without eating URLs', () => {
    expect(stripComments('a // uppercase\nb')).toBe('a \nb');
    expect(stripComments('x /* italic\n */ y')).toBe('x \n y');
    expect(stripComments("href='https://example.com'")).toBe("href='https://example.com'");
  });

  it.each(FORBIDDEN)('no routed component uses %s', (_name, pattern) => {
    const hits: string[] = [];
    for (const { path, text } of routedTsxFiles()) {
      const code = stripComments(text);
      for (const match of code.matchAll(pattern)) {
        const line = code.slice(0, match.index).split('\n').length;
        hits.push(`${path}:${line}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
