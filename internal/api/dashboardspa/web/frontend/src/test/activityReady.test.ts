import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// vk lane 6 — Discord Activity readiness guard. Inside the Activity iframe a
// `target="_blank"` anchor or a `window.location` reload breaks out of (or
// reloads) the frame, and any non-self origin (fonts, CDNs) is blocked by the
// Activity CSP. Every source file is scanned; the seams that own the one
// allowed use are exempt.

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = join(srcDir, '..', 'index.html');

/** Files other lanes still have to convert. The controller empties this at integration. */
const PENDING_OTHER_LANES: string[] = [
  'components/beads/BeadBoardRow.tsx',
  'components/home/OwnerPlate.tsx',
  'components/Header.tsx',
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'test' || name === 'node_modules') continue;
      out.push(...walk(p));
    } else if (/\.(ts|tsx|css)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(srcDir)
  .map((p) => ({ rel: relative(srcDir, p).split('\\').join('/'), text: readFileSync(p, 'utf8') }))
  .filter((f) => !PENDING_OTHER_LANES.includes(f.rel));
const html = { rel: 'index.html', text: readFileSync(indexHtml, 'utf8') };

function offenders(list: { rel: string; text: string }[], re: RegExp, allow: string[] = []): string[] {
  return list.filter((f) => !allow.includes(f.rel) && re.test(f.text)).map((f) => f.rel);
}

describe('Discord Activity readiness', () => {
  it('scans a real source tree', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('(1) no target="_blank" outside vk/ExternalLink.tsx', () => {
    expect(offenders([...files, html], /target\s*=\s*\{?\s*["'`]_blank/, ['vk/ExternalLink.tsx'])).toEqual([]);
  });

  it('(2) no window.location.assign/replace/href= outside lib/navigation.ts', () => {
    expect(
      offenders(files, /window\.location\.(assign|replace)\b|window\.location\.href\s*=(?!=)/, [
        'lib/navigation.ts',
      ]),
    ).toEqual([]);
  });

  it('(3) no external fonts or CDNs', () => {
    expect(offenders([...files, html], /fonts\.googleapis|fonts\.gstatic|\bcdn\.|unpkg|jsdelivr/)).toEqual([]);
  });

  it('(4) no @import url(http', () => {
    expect(offenders([...files, html], /@import\s+url\(\s*["']?http/)).toEqual([]);
  });
});
