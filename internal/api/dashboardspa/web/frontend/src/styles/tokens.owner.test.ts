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

const encode = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const decode = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * Contrast of `fg` text on a Tailwind fill class such as `bg-surface-tint` or
 * `bg-primary/[0.08]`, painted over `ground`. Alpha fills blend the way the
 * browser does, in gamma-encoded sRGB.
 */
function contrastOnFill(block: string, fg: string, fill: string, ground: string): number {
  const m = fill.match(/^bg-([\w-]+?)(?:\/(?:\[([\d.]+)\]|(\d+)))?$/);
  if (!m) throw new Error(`not a bg fill class: ${fill}`);
  const alpha = m[2] !== undefined ? Number(m[2]) : m[3] !== undefined ? Number(m[3]) / 100 : 1;
  const top = tokenLinear(block, m[1] ?? '').map(encode);
  const under = tokenLinear(block, ground).map(encode);
  const mixed = top.map((c, i) => decode(alpha * c + (1 - alpha) * (under[i] ?? 0))) as Rgb;
  const a = luminance(tokenLinear(block, fg));
  const b = luminance(mixed);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
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

  // design pass 15.11: dark enamel is a brighter cobalt (#3355C2) on the
  // vibe-kanban dark ladder, ground #1A1B1E (Discord's darker frame).
  it('enamel is #1B3F8B in light and #3355C2 in dark', () => {
    expect(hexClose(toHex(tokenLinear(BLOCKS.light, 'plate')), '#1B3F8B')).toBe(true);
    expect(hexClose(toHex(tokenLinear(BLOCKS.dark, 'plate')), '#3355C2')).toBe(true);
    expect(hexClose(toHex(tokenLinear(BLOCKS.light, 'surface')), '#F2F2EF')).toBe(true);
    expect(hexClose(toHex(tokenLinear(BLOCKS.light, 'fg')), '#1F2238')).toBe(true);
    expect(hexClose(toHex(tokenLinear(BLOCKS.dark, 'surface')), '#1A1B1E')).toBe(true);
  });

  it('in light the focus ring is the enamel itself (review m5: no drift)', () => {
    expect(toHex(tokenLinear(BLOCKS.light, 'plate-ring'))).toBe(
      toHex(tokenLinear(BLOCKS.light, 'plate')),
    );
  });

  it('system dark repeats the pinned dark values', () => {
    const decls = (block: string) =>
      [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)]
        .map(([, k, v]) => `${k}: ${(v ?? '').trim()}`)
        .sort();
    expect(decls(BLOCKS['system-dark'])).toEqual(decls(BLOCKS.dark));
  });

  it('the focus ring is enamel, drawn from --plate-ring', () => {
    const rule = css.match(/\.focus-mark:focus-visible\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/outline:[^;]*var\(--plate-ring\)/);
  });

  // The plate holds its own controls («Ответить», «Открыть»). There the
  // enamel ring would vanish into the enamel (1.00:1 light, 2.34:1 dark), so
  // a control on the plate draws its ring in another token.
  for (const [theme, block] of Object.entries(BLOCKS)) {
    it(`${theme}: the focus ring on the plate clears 3:1 against the plate`, () => {
      const rule = css.match(/\.bg-plate\s+\.focus-mark:focus-visible\s*\{([^}]*)\}/)?.[1] ?? '';
      const token = rule.match(/outline-color:\s*oklch\(var\(--([\w-]+)\)\)/)?.[1];
      expect(token, 'on-plate focus rule names a colour token').toBeDefined();
      expect(contrast(block, token ?? '', 'plate')).toBeGreaterThanOrEqual(3);
    });
  }

  // WCAG 1.4.11: a focus indicator needs 3:1 against what it sits on. Dark
  // enamel itself is only ~2.2:1 on the night ground, so the ring has its own
  // lighter enamel token.
  for (const [theme, block] of Object.entries(BLOCKS)) {
    it(`${theme}: the focus ring clears 3:1 on ground and panels`, () => {
      const low = GROUNDS.map((bg) => [bg, contrast(block, 'plate-ring', bg)] as const)
        .filter(([, ratio]) => ratio < 3)
        .map(([bg, ratio]) => `plate-ring on ${bg}: ${ratio.toFixed(2)}`);
      expect(low).toEqual([]);
    });
  }

  // Review I2: with primary turned ink, a primary/alpha wash is a grey veil,
  // and the selected bead row's quiet note fell to 4.40:1 in dark. The board
  // row's selected fill is read from source and measured under its note tones
  // (BeadBoardRow noteTone) on the raised column it sits in.
  it('the selected bead row keeps its note text at 4.5:1', () => {
    const row = readFileSync(join(here, '..', 'components', 'beads', 'BeadBoardRow.tsx'), 'utf8');
    const selected = row.match(/selected\s*\?\s*'([^']*)'/)?.[1] ?? '';
    const fill = selected.split(/\s+/).find((cls) => cls.startsWith('bg-'));
    expect(fill, 'selected row has a bg fill').toBeDefined();
    const low: string[] = [];
    for (const [theme, block] of Object.entries(BLOCKS)) {
      for (const fg of ['fg', 'fg-muted', 'fg-faint', 'accent', 'warn']) {
        const ratio = contrastOnFill(block, fg, fill ?? '', 'surface-raised');
        if (ratio < 4.5) low.push(`${theme} ${fg} on ${fill}: ${ratio.toFixed(2)}`);
      }
    }
    expect(low).toEqual([]);
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
