import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { embedClientId, isEmbedded } from './embed/mode';
import { DISCORD_ORIGIN, leaveDiscordFrame, moveTo } from './test/discordFrame';

// Rewritten on purpose (was noActivity.test.ts). Owner 16.11 00:10 removed
// the Discord Activity; owner 20.11 13:21 reversed that: «when the Mayor
// sends me something in Discord, I tap it and the board graph, or that exact
// card, opens INSIDE Discord» (DESIGN-discord-activity-return rev 2.1,
// approved 20.11 15:0x). His condition 20.11: nothing that works today may
// break. So the guard now pins the GATE instead of the absence:
//   - Discord mode exists only inside a real Activity frame, detected at
//     runtime from Discord's proxy origin + the SDK launch params, never by a
//     build flag or a switch a normal browser can hit;
//   - the plain web path never loads the SDK chunk and never calls the
//     Activity gateway (`/api/activity`);
//   - in Discord mode no write path exists (v1 is read-only).

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === 'test') continue;
      out.push(...sources(path));
    } else if (/\.(ts|tsx|css)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

const files = sources(here).map((p) => ({
  rel: relative(here, p).split('\\').join('/'),
  text: readFileSync(p, 'utf8'),
}));
const inEmbed = (rel: string) => rel.startsWith('embed/');

afterEach(() => {
  leaveDiscordFrame();
});

describe('Discord mode gate (owner 20.11 reversal of 16.11)', () => {
  it('scans a real source tree', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('only embed/activitySdk.ts imports the Embedded App SDK', () => {
    const hits = files
      .filter((f) => f.text.includes('@discord/embedded-app-sdk'))
      .map((f) => f.rel);
    expect(hits).toEqual(['embed/activitySdk.ts']);
  });

  it('the SDK module is reached only by main.tsx dynamic import(), so it is a lazy chunk', () => {
    const staticImport = /(?:^|\n)\s*import[^;]*from\s+['"][./]*(?:embed\/)?activitySdk['"]/;
    const offenders = files.filter((f) => staticImport.test(f.text)).map((f) => f.rel);
    expect(offenders).toEqual([]);
    const dynamic = files.filter((f) =>
      /import\(\s*['"][./]*(?:embed\/)?activitySdk['"]\s*\)/.test(f.text),
    );
    expect(dynamic.map((f) => f.rel)).toEqual(['main.tsx']);
    const main = files.find((f) => f.rel === 'main.tsx')!.text;
    // the import sits inside the isEmbedded() branch
    const branch = main.slice(main.indexOf('if (isEmbedded())'), main.indexOf('} else {'));
    expect(branch).toContain("import('./embed/activitySdk')");
  });

  it('the Activity gateway routes are named only under src/embed', () => {
    const hits = files
      .filter((f) => !inEmbed(f.rel) && f.text.includes('/api/activity'))
      .map((f) => f.rel);
    expect(hits).toEqual([]);
  });

  it('no build flag or query switch can turn Discord mode on', () => {
    const mode = files.find((f) => f.rel === 'embed/mode.ts')!.text;
    expect(mode).not.toMatch(/import\.meta\.env/);
    for (const f of files) {
      expect(f.text, f.rel).not.toMatch(/VITE_EMBED|VITE_DISCORD_CLIENT_ID|embed_preview/);
    }
  });

  it('the SDK is pinned to an exact version', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<
      string,
      Record<string, string>
    >;
    expect(pkg.dependencies?.['@discord/embedded-app-sdk']).toBe('2.5.0');
  });

  it('nothing in Discord mode stores the Discord token or the session', () => {
    for (const f of files.filter((x) => inEmbed(x.rel))) {
      expect(f.text, f.rel).not.toMatch(/localStorage|sessionStorage|document\.cookie|console\./);
    }
  });
});

describe('runtime detection', () => {
  const cases: Array<[string, boolean]> = [
    ['http://127.0.0.1/city/test-city/beads?frame_id=f&instance_id=i', false],
    ['https://macbook-air-artem.tailfa6540.ts.net/city/c/beads?frame_id=f&instance_id=i', false],
    [`${DISCORD_ORIGIN}/city/c/beads`, false],
    [`${DISCORD_ORIGIN}/?frame_id=f`, false],
    [`${DISCORD_ORIGIN}/?instance_id=i`, false],
    ['https://1571490006042939402.discordsays.com.evil.example/?frame_id=f&instance_id=i', false],
    ['https://evil.discordsays.com/?frame_id=f&instance_id=i', false],
    [`${DISCORD_ORIGIN}/?frame_id=f&instance_id=i`, true],
  ];
  it.each(cases)('%s → %s', (url, expected) => {
    moveTo(url);
    expect(isEmbedded()).toBe(expected);
    expect(embedClientId()).toBe(expected ? '1571490006042939402' : null);
  });

  it('latches for the page: in-app navigation that drops the query keeps Discord mode', () => {
    moveTo(`${DISCORD_ORIGIN}/?frame_id=f&instance_id=i`);
    expect(isEmbedded()).toBe(true);
    window.history.replaceState(null, '', '/city/c/beads?bead=dw-1');
    expect(isEmbedded()).toBe(true);
  });
});
