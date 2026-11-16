import { CITY_BASE } from './fixtures/expected';
import { DRILL_TASK, STAGE_TASKS, injectIdleBoard, injectStageBoard } from './fixtures/stageBoard';
import { gotoCityRoute } from './support/renderGuards';
import { ru } from './support/ru';
import { expect, test } from './support/fixtures';

// B8: one board, in Russian, with no service cards, test cards hidden until
// asked, and an idle notice derived from the city's own beads. The crash
// guards (no error boundary, no client-error POST) run after every test.

test.describe('one board', () => {
  test('one board', async ({ page }) => {
    await injectStageBoard(page);
    await gotoCityRoute(page, CITY_BASE, '/beads');
    await expect(page.getByText(STAGE_TASKS.pr.title, { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: ru('Board'), exact: true })).toHaveCount(1);
    for (const name of ['dw', 'dp', 'gcg']) {
      await expect(page.getByRole('region', { name, exact: true })).toHaveCount(0);
    }
  });

  test('no service card', async ({ page }) => {
    await injectStageBoard(page);
    await gotoCityRoute(page, CITY_BASE, '/beads');
    await expect(page.getByText(STAGE_TASKS.pr.title, { exact: true })).toBeVisible();
    await expect(page.getByText('order:archyl-drift-stage')).toHaveCount(0);
  });

  test('test card hidden until asked', async ({ page }) => {
    await injectStageBoard(page);
    await gotoCityRoute(page, CITY_BASE, '/beads');
    await expect(page.getByText(STAGE_TASKS.pr.title, { exact: true })).toBeVisible();
    await expect(page.getByText(DRILL_TASK.title)).toHaveCount(0);
    await page.getByRole('checkbox', { name: ru('Show test tasks ({n})', { n: 1 }) }).check();
    await expect(page.getByText(DRILL_TASK.title)).toBeVisible();
  });

  test('idle notice', async ({ page }) => {
    await injectIdleBoard(page);
    await gotoCityRoute(page, CITY_BASE, '/beads');
    await expect(page.getByText(ru('Nobody is working right now.'))).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Пакет этапа M04: исполнимый план по мастер-плану §4/§7' }),
    ).toHaveAttribute('href', `${CITY_BASE}/beads?bead=dw-4xn4b`);
  });

  test('phone has no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await injectIdleBoard(page);
    await gotoCityRoute(page, CITY_BASE, '/beads');
    const notice = page.locator('[data-idle="idle"]');
    await expect(notice).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);
    const box = await notice.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  });
});

test.describe('one board in Russian', () => {
  test('Russian', async ({ page }) => {
    await injectStageBoard(page);
    await gotoCityRoute(page, CITY_BASE, '/beads');
    await expect(page.getByRole('heading', { name: 'Задачи', level: 1 })).toBeVisible();
    // The vk board: four columns, named in Russian (the «Этапы» stop list is gone).
    const board = page.getByRole('region', { name: 'Доска', exact: true });
    for (const name of ['Ждёт', 'В работе', 'Ревью', 'Влито · за 7 дней']) {
      await expect(board.getByRole('region', { name, exact: true })).toBeVisible();
    }
  });
});
