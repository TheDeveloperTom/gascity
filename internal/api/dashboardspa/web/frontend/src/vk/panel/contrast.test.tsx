import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../i18n';
import type { OwnerQuestion } from '../../lib/ownerQuestions';
import { QuestionCard } from './TaskDrawer';

// polish2 review I-1: «Ответить в Discord» is the card's only answer action.
// Its fill and text must reach WCAG AA (4.5:1) in BOTH themes. The colours
// come from the real tokens in styles/index.css (oklch), not from comments.

/** The `--name: L% C h;` value inside one CSS block. */
function token(block: string, name: string): [number, number, number] {
  const m = new RegExp(`--${name}:\\s*([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)`).exec(block);
  if (m === null) throw new Error(`no --${name}`);
  return [Number(m[1]) / 100, Number(m[2]), Number(m[3])];
}

/** oklch → relative luminance (WCAG), via OKLab → linear sRGB. */
function luminance([L, C, h]: [number, number, number]): number {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const r = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bl = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

function contrast(x: [number, number, number], y: [number, number, number]): number {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// Read like consistency.redesign.test does (vitest empties a CSS ?raw import).
const css = readFileSync(join(process.cwd(), 'src/styles/index.css'), 'utf8');

const LIGHT = css.slice(css.indexOf(':root {'), css.indexOf(":root[data-theme='dark']"));
const DARK = css.slice(css.indexOf(":root[data-theme='dark']"), css.indexOf('@media (prefers-color-scheme: dark)'));

/** The token behind a `bg-vk-…` class, through the `--vk-…: var(--…)` alias. */
function fillToken(cls: string): string {
  const vk = /(?:^|\s)bg-(vk-[a-z-]+)(?:\s|$)/.exec(cls)?.[1];
  if (vk === undefined) throw new Error(`no bg-vk-* in ${cls}`);
  const alias = new RegExp(`--${vk}:\\s*var\\(--([a-z-]+)\\)`).exec(css)?.[1];
  if (alias === undefined) throw new Error(`no alias for --${vk}`);
  return alias;
}

const Q: OwnerQuestion = {
  beadId: 'gc-q',
  questionId: 'q-1',
  question: 'Когда окно?',
  why: null,
  choices: [],
  chatUrl: 'https://discord.com/channels/1/2/3',
  askedAt: null,
} as unknown as OwnerQuestion;

afterEach(() => {
  cleanup();
  setLocale('en');
});

describe('«Ответить в Discord» contrast (review I-1)', () => {
  it('reads the real stylesheet', () => {
    expect(css.length, String(css.slice(0, 80))).toBeGreaterThan(5000);
  });

  it('the token maths is right: white on #1B3F8B is about 10:1', () => {
    expect(contrast([0.39, 0.134, 262.8], [1, 0, 0])).toBeGreaterThan(9);
  });

  it('reaches 4.5:1 in the light and the dark theme', () => {
    setLocale('ru');
    render(<QuestionCard q={Q} onAnswered={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Ответить в Discord' });
    const fill = fillToken(btn.className);
    for (const [theme, block] of [
      ['light', LIGHT],
      ['dark', DARK],
    ] as const) {
      const ratio = contrast(token(block, fill), token(block, 'on-plate'));
      expect(ratio, `${theme}: --${fill} vs --on-plate`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
