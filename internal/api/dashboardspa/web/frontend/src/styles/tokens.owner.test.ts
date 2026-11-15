import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error tailwind.config.js is plain JS and ships no declaration.
import tailwindConfigRaw from '../../tailwind.config.js';

type Extend = {
  colors: Record<string, string>;
  fontFamily: Record<string, string[]>;
  borderRadius: Record<string, string>;
};
const extend = (tailwindConfigRaw as { theme: { extend: Extend } }).theme.extend;

// «Табличка» token contract (OWNER-HOME-REVIEW §4). The CSS is read as text
// and every OKLCH triplet is converted back to sRGB here, so the contrast the
// review measured on hex values is re-checked on the values that actually ship.

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'index.css'), 'utf8');

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

const BLOCKS = {
  light: blockAfter(css, ':root {'),
  dark: blockAfter(css, ":root[data-theme='dark'] {"),
  'system-dark': blockAfter(css, '@media (prefers-color-scheme: dark) {'),
} as const;

type Rgb = [number, number, number];

/** `--name: L% C H` in a block, as linear-light sRGB (clamped to gamut). */
function tokenLinear(block: string, name: string): Rgb {
  const m = block.match(new RegExp(`--${name}:\\s*([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\s*;`));
  if (!m) throw new Error(`--${name} missing or not an OKLCH triplet`);
  const L = Number(m[1]) / 100;
  const C = Number(m[2]);
  const h = (Number(m[3]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clamp(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s),
  ];
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(block: string, fg: string, bg: string): number {
  const a = luminance(tokenLinear(block, fg));
  const b = luminance(tokenLinear(block, bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function toHex(rgb: Rgb): string {
  const enc = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  return `#${rgb
    .map((c) =>
      Math.round(enc(c) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;
}

function hexClose(actual: string, expected: string): boolean {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  return [0, 1, 2].every((i) => Math.abs(ch(actual, i) - ch(expected, i)) <= 1);
}

// Review §4 "Measured contrast": every text role on every ground it is drawn
// on (page, panel, hover row), and the two plate texts on the plate.
const TEXT_ON_GROUND = ['fg', 'fg-muted', 'fg-faint', 'warn', 'accent', 'ok', 'primary'];
const GROUNDS = ['surface', 'surface-raised', 'surface-tint'];
const PAIRS: Array<[string, string]> = [
  ...TEXT_ON_GROUND.flatMap((fg) => GROUNDS.map((bg): [string, string] => [fg, bg])),
  ['on-plate', 'plate'],
  ['on-plate-muted', 'plate'],
  ['on-primary', 'primary'],
];

describe('«Табличка» tokens', () => {
  for (const [theme, block] of Object.entries(BLOCKS)) {
    it(`${theme}: every measured pair clears 4.5:1`, () => {
      expect(block, `${theme} block present`).not.toBe('');
      const low = PAIRS.map(([fg, bg]) => [fg, bg, contrast(block, fg, bg)] as const)
        .filter(([, , ratio]) => ratio < 4.5)
        .map(([fg, bg, ratio]) => `${fg} on ${bg}: ${ratio.toFixed(2)}`);
      expect(low).toEqual([]);
    });

    it(`${theme}: primary is ink, not a second blue`, () => {
      expect(toHex(tokenLinear(block, 'primary'))).toBe(toHex(tokenLinear(block, 'fg')));
    });
  }

  it('enamel is #1B3F8B in light and #2C4E9E in dark', () => {
    expect(hexClose(toHex(tokenLinear(BLOCKS.light, 'plate')), '#1B3F8B')).toBe(true);
    expect(hexClose(toHex(tokenLinear(BLOCKS.dark, 'plate')), '#2C4E9E')).toBe(true);
    expect(hexClose(toHex(tokenLinear(BLOCKS.light, 'surface')), '#F2F2EF')).toBe(true);
    expect(hexClose(toHex(tokenLinear(BLOCKS.light, 'fg')), '#1F2238')).toBe(true);
    expect(hexClose(toHex(tokenLinear(BLOCKS.dark, 'surface')), '#1B1C22')).toBe(true);
  });

  it('system dark repeats the pinned dark values', () => {
    const decls = (block: string) =>
      [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)]
        .map(([, k, v]) => `${k}: ${(v ?? '').trim()}`)
        .sort();
    expect(decls(BLOCKS['system-dark'])).toEqual(decls(BLOCKS.dark));
  });

  it('the focus ring is enamel', () => {
    const rule = css.match(/\.focus-mark:focus-visible\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/outline:[^;]*var\(--plate\)/);
  });

  it('ink links carry an underline at rest (review §5: blue stays on the plate)', () => {
    // primary is ink now, so colour alone no longer tells a link from text.
    // Element-only specificity (0,0,1): beats preflight's `a` reset by order,
    // loses to every utility class on the element.
    const rule = css.match(/\ba:where\(\.text-primary\)\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/text-decoration-line:\s*underline/);
  });

  it('self-hosts PT Sans Narrow Bold for Latin and Cyrillic', () => {
    const dir = join(here, '..', 'assets', 'fonts', 'pt-sans-narrow');
    for (const subset of ['latin', 'cyrillic']) {
      const file = `pt-sans-narrow-${subset}-700-normal.woff2`;
      expect(existsSync(join(dir, file)), file).toBe(true);
      const face = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)]
        .map(([, body]) => body ?? '')
        .find((body) => body.includes(file));
      expect(face, `@font-face for ${file}`).toBeDefined();
      expect(face).toMatch(/font-family:\s*'PT Sans Narrow'/);
      expect(face).toMatch(/font-weight:\s*700/);
    }
    expect(existsSync(join(dir, 'OFL.txt'))).toBe(true);
  });

  it('tailwind exposes the plate and the display face', () => {
    expect(extend.fontFamily.display?.[0]).toBe('"PT Sans Narrow"');
    expect(extend.colors.plate).toBe('oklch(var(--plate) / <alpha-value>)');
    expect(extend.colors['on-plate']).toBe('oklch(var(--on-plate) / <alpha-value>)');
    expect(extend.colors['on-plate-muted']).toBe('oklch(var(--on-plate-muted) / <alpha-value>)');
    expect(extend.borderRadius.plate).toBe('12px');
  });
});
