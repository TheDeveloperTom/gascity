import { CITY_BASE } from './fixtures/expected';
import { ROUTE_BEAD_IDS, STAGE_TASKS, injectStageBoard } from './fixtures/stageBoard';
import { gotoCityRoute } from './support/renderGuards';
import { ru } from './support/ru';
import { expect, test } from './support/fixtures';

// Stage board (owner ruling 2026-11-15), as the vk board shows it in Russian:
// four columns «Ждёт», «В работе», «Ревью» (review and PR together) and
// «Влито · за 7 дней», with the route's step beads folded into their task.
// Fixtures (e2e/fixtures/stageBoard.ts) are layered onto the seeded fake
// supervisor's real responses.

const WAITING = ru('Waiting');
const WORKING = ru('Working');
const REVIEW = ru('Review');
const MERGED = ru('Merged · last 7 days');

test.describe('beads stage board', () => {
  test.beforeEach(async ({ page }) => {
    await injectStageBoard(page);
    await gotoCityRoute(page, CITY_BASE, '/beads');
    await expect(page.getByRole('heading', { name: ru('Beads'), level: 1 })).toBeVisible();
  });

  test('places every task in its route stage', async ({ page }) => {
    const board = page.getByRole('region', { name: ru('Board'), exact: true });
    const expected: Array<[string, string]> = [
      [WAITING, STAGE_TASKS.waiting.title],
      [WAITING, STAGE_TASKS.blocked.title],
      [WAITING, STAGE_TASKS.queued.title],
      [WORKING, STAGE_TASKS.working.title],
      [WORKING, STAGE_TASKS.tdd.title],
      [REVIEW, STAGE_TASKS.review.title],
      [REVIEW, STAGE_TASKS.pr.title],
      [REVIEW, STAGE_TASKS.stopped.title],
      [MERGED, STAGE_TASKS.merged.title],
      [MERGED, STAGE_TASKS.noop.title],
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
      await expect(page.locator(`[title="${ru('Select {id}', { id })}"]`)).toHaveCount(0);
    }
    const step = page.getByTitle(
      ru('Open step {id} in its run', { id: 'gcg-w.verify-test-fails' }),
    );
    await expect(step).toContainText('Verify Superpowers task test fails');
    await expect(step).toHaveAttribute(
      'href',
      `${CITY_BASE}/runs/gcg-w?scope_kind=city&scope_ref=dashport-city&node=gcg-w.verify-test-fails`,
    );
  });

  // The vk card shows no run line while a task waits (its queued run is on the
  // run page), so only the PR link and the marks are asserted here.
  test('shows the PR link and the marks on the cards', async ({ page }) => {
    const review = page.getByRole('region', { name: REVIEW, exact: true });
    await expect(review.getByRole('link', { name: '#512' })).toHaveAttribute(
      'href',
      'https://github.com/example/devwork/pull/512',
    );
    await expect(page.locator('[data-route-attention="stopped"]')).toContainText(
      STAGE_TASKS.stopped.title,
    );
    await expect(page.locator('[data-route-attention="tdd-refused"]')).toContainText(
      STAGE_TASKS.tdd.title,
    );
    await expect(
      page
        .getByRole('region', { name: WAITING, exact: true })
        .getByText(ru('blocked'), { exact: true }),
    ).toBeVisible();
  });

  test('shows recent merges; older ones wait behind «Показать старые»', async ({ page }) => {
    const merged = page.getByRole('region', { name: MERGED, exact: true });
    await expect(merged.getByText(STAGE_TASKS.merged.title, { exact: true })).toBeVisible();
    const before = await merged.locator('article').count();
    await merged.getByRole('button', { name: ru('Show older') }).click();
    await expect.poll(() => merged.locator('article').count()).toBeGreaterThan(before);
  });

  test('a card still opens the bead dialog', async ({ page }) => {
    await page.locator(`[title="${ru('Select {id}', { id: STAGE_TASKS.review.id })}"]`).click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByRole('heading', { name: STAGE_TASKS.review.title })).toBeVisible();
    await modal
      .getByRole('button', { name: ru('Close') })
      .first()
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
