import { join } from 'node:path';
import { CITY_BASE } from './fixtures/expected';
import { STAGE_TASKS, injectStageBoard } from './fixtures/stageBoard';
import { gotoCityRoute } from './support/renderGuards';
import { expect, test } from './support/fixtures';

// Review screenshots of the stage board (light and dark, desktop and phone)
// against the seeded fake supervisor plus the stage fixtures. Skipped in the
// normal e2e run; set STAGE_SHOTS_DIR to an output directory to capture.

const OUT = process.env['STAGE_SHOTS_DIR'];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const;

test.describe('stage board screenshots', () => {
  test.skip(OUT === undefined, 'set STAGE_SHOTS_DIR to capture review screenshots');

  for (const theme of ['light', 'dark'] as const) {
    for (const vp of VIEWPORTS) {
      test(`beads-stage ${vp.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.emulateMedia({ colorScheme: theme });
        await page.addInitScript((t) => {
          try {
            window.localStorage.setItem('gascity:theme', t);
          } catch {
            // storage may be unavailable; the media query still applies
          }
        }, theme);
        await injectStageBoard(page);
        await gotoCityRoute(page, CITY_BASE, '/beads');
        await expect(page.getByText(STAGE_TASKS.pr.title, { exact: true })).toBeVisible();
        await page.waitForTimeout(600);
        await page.screenshot({
          path: join(OUT ?? '.', `beads-stage-${vp.name}-${theme}.png`),
          fullPage: true,
        });
      });
    }
  }
});
