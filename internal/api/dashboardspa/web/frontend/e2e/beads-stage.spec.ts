import { CITY_BASE } from './fixtures/expected';
import { ROUTE_BEAD_IDS, STAGE_TASKS, injectStageBoard } from './fixtures/stageBoard';
import { gotoCityRoute } from './support/renderGuards';
import { expect, test } from './support/fixtures';

// Stage board (owner ruling 2026-11-15): the Beads board shows each task in our
// route's lifecycle, Waiting → Working → Review → PR → Merged, with the route's
// step beads folded into their task. Fixtures (e2e/fixtures/stageBoard.ts) are
// layered onto the seeded fake supervisor's real responses.

test.describe('beads stage board', () => {
  test.beforeEach(async ({ page }) => {
    await injectStageBoard(page);
    await gotoCityRoute(page, CITY_BASE, '/beads');
    await expect(page.getByRole('heading', { name: 'Beads', level: 1 })).toBeVisible();
  });

  test('places every task in its route stage', async ({ page }) => {
    const board = page.getByRole('region', { name: 'Board', exact: true });
    const expected: Array<[string, string]> = [
      ['Waiting', STAGE_TASKS.waiting.title],
      ['Waiting', STAGE_TASKS.blocked.title],
      ['Waiting', STAGE_TASKS.queued.title],
      ['Working', STAGE_TASKS.working.title],
      ['Working', STAGE_TASKS.tdd.title],
      ['Review', STAGE_TASKS.review.title],
      ['PR', STAGE_TASKS.pr.title],
      ['PR', STAGE_TASKS.stopped.title],
      ['Merged', STAGE_TASKS.merged.title],
      ['Merged', STAGE_TASKS.noop.title],
    ];
    for (const [column, title] of expected) {
      await expect(
        board.getByRole('region', { name: column, exact: true }).getByText(title, { exact: true }),
      ).toBeVisible();
    }
  });

  test('folds route steps into their task', async ({ page }) => {
    await expect(page.getByText(STAGE_TASKS.working.title, { exact: true })).toBeVisible();
    for (const id of ROUTE_BEAD_IDS) {
      await expect(page.locator(`[title="Select ${id}"]`)).toHaveCount(0);
    }
    const step = page.getByTitle('Open step gcg-w.verify-test-fails in its run');
    await expect(step).toHaveText('Verify Superpowers task test fails');
    await expect(step).toHaveAttribute(
      'href',
      `${CITY_BASE}/runs/gcg-w?scope_kind=city&scope_ref=dashport-city&node=gcg-w.verify-test-fails`,
    );
  });

  test('shows PR link, queued run and marks on the cards', async ({ page }) => {
    const pr = page.getByRole('region', { name: 'PR', exact: true });
    await expect(pr.getByRole('link', { name: 'PR #512' })).toHaveAttribute(
      'href',
      'https://github.com/example/devwork/pull/512',
    );
    await expect(page.getByTitle('Open run gcg-q')).toHaveText('Queued');
    const stopped = page.locator('li[data-route-attention="stopped"]');
    await expect(stopped).toContainText(STAGE_TASKS.stopped.title);
    await expect(page.locator('li[data-route-attention="tdd-refused"]')).toContainText(
      STAGE_TASKS.tdd.title,
    );
    await expect(
      page
        .getByRole('region', { name: 'Waiting', exact: true })
        .getByText('blocked', { exact: true }),
    ).toBeVisible();
  });

  test('shows recent merges without the closed chip', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'closed' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(
      page
        .getByRole('region', { name: 'Merged', exact: true })
        .getByText('merged into main at 3f2a9c1 (PR #498)'),
    ).toBeVisible();
  });

  test('a card still opens the bead dialog', async ({ page }) => {
    await page.locator(`[title="Select ${STAGE_TASKS.review.id}"]`).click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByRole('heading', { name: STAGE_TASKS.review.title })).toBeVisible();
    await modal.getByRole('button', { name: 'Close' }).first().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
