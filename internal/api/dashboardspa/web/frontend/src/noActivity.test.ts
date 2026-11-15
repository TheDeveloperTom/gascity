import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Owner 16.11 00:10: the Discord Activity is gone. The dashboard is a plain
// web app on Tailscale (and a PWA). No embed mode, no Embedded App SDK, no
// /api/activity gateway calls, no Activity sessions or headers. This guard
// scans the shipped sources so nothing of it comes back by accident.

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx|css)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

const FORBIDDEN = [
  '@discord/embedded-app-sdk',
  '/api/activity',
  'VITE_EMBED',
  'VITE_DISCORD_CLIENT_ID',
  'isEmbedded',
  'activitySession',
  'activitySdk',
  'embed_preview',
  'setAuthHeaders',
  'fetchWithSessionRetry',
  'discord-safe-area',
  'frame_id',
];

describe('no Discord Activity left (owner 16.11)', () => {
  it('the embed folder is gone', () => {
    expect(existsSync(join(here, 'embed'))).toBe(false);
  });

  it('no shipped source names the Activity, its SDK, its routes or its session', () => {
    const hits: string[] = [];
    for (const file of [...sources(here), join(root, 'index.html'), join(root, 'vite.config.ts')]) {
      const text = readFileSync(file, 'utf8');
      for (const word of FORBIDDEN) {
        if (text.includes(word)) hits.push(`${relative(root, file)}: ${word}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('the Embedded App SDK is not a dependency', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, Record<string, string>>;
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })).not.toContain('@discord/embedded-app-sdk');
  });
});
