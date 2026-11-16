/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectMissing, resetMissing, setLocale, t, tn } from './index';

// polish2 16.11 (owner): the Russian UI must never show an English string or a
// raw key. This walks every non-test source file, collects each key handed to
// t()/tn() as a literal, plus the values of the label maps passed to t() as
// `t(MAP[x])`, and asserts the Russian lookup has every one.

const SOURCES = import.meta.glob(
  ['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../test/**', '!../**/generated/**'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
) as Record<string, string>;

// Readable JS string literal: '...', "..." or a `...` without ${}.
const LIT = String.raw`'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|\`((?:[^\`\\$]|\\.)*)\``;

function unescape(s: string): string {
  return s.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c));
}

function literalAt(m: RegExpExecArray, from: number): string | undefined {
  const v = m[from] ?? m[from + 1] ?? m[from + 2];
  return v === undefined ? undefined : unescape(v);
}

interface Found {
  singles: Map<string, string>; // key -> first file
  plurals: Map<string, { one: string; file: string }>;
}

function scan(): Found {
  const singles = new Map<string, string>();
  const plurals = new Map<string, { one: string; file: string }>();
  const callT = new RegExp(String.raw`(?<![\w.])t\(\s*(?:${LIT})\s*[,)]`, 'g');
  const callTn = new RegExp(
    String.raw`(?<![\w.])tn\([^,]+,\s*\{\s*one:\s*(?:${LIT})\s*,\s*other:\s*(?:${LIT})`,
    'g',
  );
  // `t(MAP[x])` directly, or `const key = MAP[x]; … t(key)` (statusLabel).
  const callMap =
    /(?<![\w.])t\(\s*([A-Z][A-Z0-9_]*)\[|const \w+ = ([A-Z][A-Z0-9_]*)\[[^\]]+\];\s*\n\s*return \w+ === undefined \? \w+ : t\(/g;
  const callConst = /(?<![\w.])t\(\s*([A-Z][A-Z0-9_]*)\s*[,)]/g;
  for (const [file, src] of Object.entries(SOURCES)) {
    if (file.includes('/i18n/')) continue;
    for (let m = callConst.exec(src); m !== null; m = callConst.exec(src)) {
      const decl = new RegExp(String.raw`const ${m[1]!}\b[^=]*=\s*(?:${LIT})`).exec(src);
      const key = decl === null ? undefined : literalAt(decl, 1);
      if (key !== undefined && !singles.has(key)) singles.set(key, `${file} (${m[1]!})`);
    }
    for (let m = callT.exec(src); m !== null; m = callT.exec(src)) {
      const key = literalAt(m, 1);
      if (key !== undefined && !singles.has(key)) singles.set(key, file);
    }
    for (let m = callTn.exec(src); m !== null; m = callTn.exec(src)) {
      const one = literalAt(m, 1);
      const other = literalAt(m, 4);
      if (one !== undefined && other !== undefined) plurals.set(other, { one, file });
    }
    for (let m = callMap.exec(src); m !== null; m = callMap.exec(src)) {
      const name = (m[1] ?? m[2])!;
      const decl = new RegExp(String.raw`const ${name}\b[^=]*=\s*\{([\s\S]*?)\n\}`).exec(src);
      if (decl === null) continue;
      const value = new RegExp(String.raw`:\s*(?:${LIT})\s*,`, 'g');
      for (let v = value.exec(decl[1]!); v !== null; v = value.exec(decl[1]!)) {
        const key = literalAt(v, 1);
        if (key !== undefined && !singles.has(key)) singles.set(key, `${file} (${name})`);
      }
    }
  }
  return { singles, plurals };
}

describe('i18n coverage (every key used in the UI has a Russian entry)', () => {
  beforeEach(() => {
    resetMissing();
    setLocale('ru');
  });
  afterEach(() => {
    setLocale('en');
  });

  it('the scan finds the UI keys (guards a silently empty glob)', () => {
    const { singles } = scan();
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
    expect(singles.size).toBeGreaterThan(300);
    expect(singles.has('Answer in Discord')).toBe(true);
    expect(singles.has('status.open')).toBe(true);
    // review M-6: `t(CONST)` where `const CONST = '…'`
    expect(
      singles.has('Stages, in order: intake, implementation, review, approval, finalization.'),
    ).toBe(true);
  });

  it('every t() key and every label-map value used with t() is translated', () => {
    const { singles } = scan();
    const missing: string[] = [];
    for (const [key, file] of singles) {
      resetMissing();
      t(key);
      if (collectMissing().length > 0) missing.push(`${key}  ←  ${file}`);
    }
    expect(missing).toEqual([]);
  });

  it('every tn() plural is translated', () => {
    const { plurals } = scan();
    const missing: string[] = [];
    for (const [other, { one, file }] of plurals) {
      resetMissing();
      tn(2, { one, other });
      if (collectMissing().length > 0) missing.push(`${other}  ←  ${file}`);
    }
    expect(missing).toEqual([]);
  });
});
