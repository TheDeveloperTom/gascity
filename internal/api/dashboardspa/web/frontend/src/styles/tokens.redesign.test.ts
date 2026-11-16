import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Signal & Pavement token contract (DESIGN-PLAN §3–§5). The CSS and the
// Tailwind config are read as text so the test pins the shipped values, not
// a computed style jsdom cannot resolve. Paths go through fileURLToPath:
// Vite rewrites the `new URL(rel, import.meta.url)` pattern into an asset
// URL, which node:fs rejects.

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'index.css'), 'utf8');
const tailwind = readFileSync(join(here, '..', '..', 'tailwind.config.js'), 'utf8');

const TOKENS = [
  'surface',
  'surface-raised',
  'surface-tint',
  'fg',
  'fg-muted',
  'fg-faint',
  'rule',
  'primary',
  'on-primary',
  'accent',
  'warn',
  'ok',
  'scrim',
] as const;

/** Body of the first `{ … }` block that opens right after `opener`. */
function blockAfter(source: string, opener: string): string {
  const start = source.indexOf(opener);
  if (start < 0) return '';
  const open = source.indexOf('{', start + opener.length - 1);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return '';
}

const lightBlock = blockAfter(css, ':root {');
const darkBlock = blockAfter(css, ":root[data-theme='dark'] {");
const systemDarkBlock = blockAfter(css, '@media (prefers-color-scheme: dark) {');

describe('Signal & Pavement tokens', () => {
  it('defines all 13 tokens in light, dark and system-dark blocks', () => {
    for (const [name, block] of [
      ['light', lightBlock],
      ['dark', darkBlock],
      ['system-dark', systemDarkBlock],
    ] as const) {
      expect(block, `${name} block present`).not.toBe('');
      for (const token of TOKENS) {
        expect(block, `${name} defines --${token}`).toContain(`--${token}:`);
      }
    }
  });

  it('pins signal values', () => {
    // vk-1to1 16.11: canvas VK values; primary is text-high.
    expect(lightBlock).toContain('--accent: 53.4% 0.161 24.4'); // #B83B3B
    expect(lightBlock).toContain('--primary: 15.9% 0 0'); // #0D0D0D
    expect(darkBlock).toContain('--accent: 71.4% 0.128 20.8'); // #E88080
    expect(darkBlock).toContain('--primary: 97% 0 0'); // #F5F5F5
  });

  it('self-hosts Golos and drops Inter', () => {
    expect(css).not.toContain('@fontsource-variable/inter');
    for (const subset of ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext']) {
      const file = `golos-text-${subset}-wght-normal.woff2`;
      expect(css).toContain(file);
      expect(existsSync(join(here, '..', 'assets', 'fonts', 'golos-text', file))).toBe(true);
    }
  });

  it('focus is enamel and selection is ink', () => {
    expect(css).toMatch(/\.focus-mark:focus-visible\s*\{[^}]*var\(--plate-ring\)/);
    expect(css).toMatch(/::selection\s*\{[^}]*var\(--primary\)/);
  });

  it('the focus ring keeps the control shape', () => {
    // A border-radius here (specificity 0,2,0) beats every rounded-* utility,
    // so a pill or nav item would turn square on keyboard focus. The outline
    // follows the element's own radius in current browsers.
    const rule = css.match(/\.focus-mark:focus-visible\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).not.toBe('');
    expect(rule).not.toMatch(/border-radius/);
  });

  it('tailwind exposes the tokens', () => {
    expect(tailwind).toContain("primary: 'oklch(var(--primary) / <alpha-value>)'");
    expect(tailwind).toContain("'surface-raised': 'oklch(var(--surface-raised) / <alpha-value>)'");
    expect(tailwind).toContain(`'"Golos Text Variable"'`);
    expect(tailwind).toContain("reading: ['1rem'");
  });
});
