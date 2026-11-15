import { join } from 'node:path';
import { CITY_BASE } from './fixtures/expected';
import { injectIdleBoard, injectStageBoard } from './fixtures/stageBoard';
import { gotoCityRoute } from './support/renderGuards';
import { expect, test } from './support/fixtures';

// B8 review screenshots of the one board, in Russian: the busy fixture and the
// live-shaped idle fixture, light and dark, desktop and phone. Skipped in the
// normal e2e run; set BOARD_SHOTS_DIR to an output directory to capture.

const OUT = process.env['BOARD_SHOTS_DIR'];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const;

const FIXTURES = [
  { name: 'busy', inject: injectStageBoard, ready: 'Влито' },
  { name: 'idle', inject: injectIdleBoard, ready: 'Сейчас никто не работает.' },
] as const;

test.describe('board screenshots', () => {
  test.skip(OUT === undefined, 'set BOARD_SHOTS_DIR to capture review screenshots');
  test.use({ locale: 'ru-RU' });

  for (const fixture of FIXTURES) {
    for (const theme of ['light', 'dark'] as const) {
      for (const vp of VIEWPORTS) {
        test(`board ${fixture.name} ${vp.name} ${theme}`, async ({ page }) => {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await page.emulateMedia({ colorScheme: theme });
          await page.addInitScript((t) => {
            try {
              window.localStorage.setItem('gascity:theme', t);
              window.localStorage.setItem('gascity:locale', 'ru');
            } catch {
              // storage may be unavailable; the media query still applies
            }
          }, theme);
          await fixture.inject(page);
          await gotoCityRoute(page, CITY_BASE, '/beads');
          await expect(page.getByText(fixture.ready).first()).toBeVisible();
          await page.waitForTimeout(600);
          await page.screenshot({
            path: join(OUT ?? '.', `board-${fixture.name}-${vp.name}-${theme}.png`),
            fullPage: true,
          });
        });
      }
    }
  }
});
