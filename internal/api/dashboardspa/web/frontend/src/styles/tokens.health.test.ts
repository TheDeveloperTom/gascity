import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// vk/health2: the Health charts draw with the VK canvas palette, not a second
// palette of their own. Every `--viz-*` mark colour is an alias of a VK token,
// so it follows both themes with the rest of the canvas.

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'index.css'), 'utf8');

describe('Health chart colours', () => {
  const vizDecls = [...css.matchAll(/--viz-[\w-]+\s*:\s*([^;]+);/g)].map((m) => m[1]!.trim());

  it('defines the chart line colour', () => {
    expect(vizDecls.length).toBeGreaterThan(0);
  });

  it('aliases VK tokens only, never a literal colour', () => {
    for (const value of vizDecls) {
      expect(value).toMatch(/^var\(--vkc?-[\w-]+\)$/);
    }
  });

  it('keeps no theme override of its own (the VK token carries the theme)', () => {
    const declared = [...css.matchAll(/(--viz-[\w-]+)\s*:/g)].map((m) => m[1]);
    expect(new Set(declared).size).toBe(declared.length);
  });
});
