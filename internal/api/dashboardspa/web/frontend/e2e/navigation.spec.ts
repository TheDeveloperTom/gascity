import type { Page } from '@playwright/test';

import {
  ANCHOR_FORMULA,
  ANCHOR_RUN_ID,
  CITY_BASE,
  CITY_NAME,
  REVIEW_BEAD_ID,
  REVIEW_BEAD_TITLE,
} from './fixtures/expected';
import { ru } from './support/ru';
import { gotoCityRoute } from './support/renderGuards';
import { expect, test } from './support/fixtures';

// Client-side navigation smoke. render-smoke.spec.ts deep-links every route with
// page.goto — one full document load per route — which proves each route
// resolves, but would also pass if the router stopped intercepting clicks and
// every navigation fell back to a native page load (the supervisor serves the
// SPA shell at every path). These specs drive the router itself under the
// production <BrowserRouter basename="/city/{name}">: header <NavLink>s, in-content
// <Link>s with encoded path params and query strings, useNavigate,
// useSearchParams' setter, back/forward (popstate), and the catch-all route.
//
// Each spec marks the document after its first load and asserts the mark
// survives every navigation: a full document load would reset it.

type MarkedWindow = Window & { __gcNavigationMark?: boolean };

async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as MarkedWindow).__gcNavigationMark = true;
  });
}

async function expectSameDocument(page: Page): Promise<void> {
  const marked = await page.evaluate(() => (window as MarkedWindow).__gcNavigationMark === true);
  expect(marked, 'navigation reloaded the document instead of routing client-side').toBe(true);
}

function inCity(path: string): (url: URL) => boolean {
  return (url) => url.pathname === `${CITY_BASE}${path}`;
}

// The vk header keeps «Нужно от меня» and «Доска» in the bar; every page is in
// the «Ещё» menu («Все разделы»), in render order. Names are prefix matches: a
// nav link's accessible name also carries its attention badge count.
const NAV_ROUTES = [
  { label: 'Runs', path: '/runs', heading: ru('Runs') },
  { label: 'Agents', path: '/agents', heading: ru('Agents') },
  { label: 'Beads', path: '/beads', heading: ru('Beads') },
  { label: 'Mail', path: '/mail', heading: ru('Mail') },
  { label: 'Activity', path: '/activity', heading: ru('Activity') },
  { label: 'Health', path: '/health', heading: ru('Health') },
] as const;

const startsWith = (label: string) => new RegExp(`^${ru(label)}`);

/** Opens the header's «Ещё» menu and returns its «Все разделы» nav. */
async function allPages(page: Page) {
  const nav = page.getByRole('navigation', { name: ru('All pages') });
  if (!(await nav.isVisible()))
    await page.locator(`header summary[aria-label="${ru('More')}"]`).click();
  await expect(nav).toBeVisible();
  return nav;
}

test.describe('dashboard client-side navigation', () => {
  test('header nav links route client-side under the city basename', async ({ page }) => {
    const routerWarnings: string[] = [];
    page.on('console', (message) => {
      if (/react router|no routes matched|<Router>/i.test(message.text())) {
        routerWarnings.push(message.text());
      }
    });

    await gotoCityRoute(page, CITY_BASE, '');
    await expect(page.getByRole('heading', { name: ru('Needs from me'), level: 1 })).toBeAttached();
    await markDocument(page);

    const home = (await allPages(page)).getByRole('link', { name: ru('Home'), exact: true });
    await expect(home).toHaveAttribute('aria-current', 'page');

    for (const route of NAV_ROUTES) {
      const link = (await allPages(page)).getByRole('link', { name: startsWith(route.label) });
      // The basename prefixes every rendered href.
      await expect(link).toHaveAttribute('href', `${CITY_BASE}${route.path}`);
      await link.click();
      await expect(page).toHaveURL(inCity(route.path));
      await expect(page.getByRole('heading', { name: route.heading, level: 1 })).toBeVisible();
      const nav = await allPages(page);
      await expect(nav.getByRole('link', { name: startsWith(route.label) })).toHaveAttribute(
        'aria-current',
        'page',
      );
      // `end` keeps Home inactive on every nested route.
      await expect(nav.getByRole('link', { name: ru('Home'), exact: true })).not.toHaveAttribute(
        'aria-current',
        'page',
      );
      await page.keyboard.press('Escape');
      await expectSameDocument(page);
    }

    // Back and forward replay history entries through popstate.
    await page.goBack();
    await expect(page).toHaveURL(inCity('/activity'));
    await expect(page.getByRole('heading', { name: ru('Activity'), level: 1 })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(inCity('/health'));
    await expect(page.getByRole('heading', { name: ru('Health'), level: 1 })).toBeVisible();
    await expectSameDocument(page);

    await (await allPages(page)).getByRole('link', { name: ru('Home'), exact: true }).click();
    await expect(page.getByRole('heading', { name: ru('Needs from me'), level: 1 })).toBeAttached();
    await expect(page).toHaveURL(
      (url) => url.pathname === CITY_BASE || url.pathname === `${CITY_BASE}/`,
    );
    await expectSameDocument(page);

    expect(routerWarnings).toEqual([]);
  });

  test('agent links carry an encoded slug and useNavigate returns to the list', async ({
    page,
  }) => {
    await gotoCityRoute(page, CITY_BASE, '/agents');
    await expect(page.getByRole('heading', { name: ru('Agents'), level: 1 })).toBeVisible();
    await markDocument(page);
    // The seeded pool members are idle; the default running-only filter hides them.
    await page.getByRole('checkbox', { name: ru('running') }).uncheck();

    // Pool members are rig-qualified ("demo/builder-1"): the link encodes the
    // slash into the :slug segment and the detail page reads it back decoded.
    const member = page.locator('main').getByRole('link', { name: /builder-1/ });
    await expect(member).toHaveAttribute('href', `${CITY_BASE}/agents/demo%2Fbuilder-1`);
    await member.click();
    await expect(page).toHaveURL(inCity('/agents/demo%2Fbuilder-1'));
    // An idle pool member has no live session, so the detail page renders its
    // no-session state, which echoes the decoded slug.
    await expect(page.getByText(ru('No session matches demo/builder-1.'))).toBeVisible();
    await expectSameDocument(page);

    // The no-session state's back button navigates with useNavigate.
    await page.getByRole('button', { name: ru('← Agents') }).click();
    await expect(page).toHaveURL(inCity('/agents'));
    await expect(page.getByRole('heading', { name: ru('Agents'), level: 1 })).toBeVisible();
    await expectSameDocument(page);
  });

  test('run links keep their query string and the history toggle sets search params', async ({
    page,
  }) => {
    await gotoCityRoute(page, CITY_BASE, '/runs');
    await expect(page.getByRole('heading', { name: ru('Runs'), level: 1 })).toBeVisible();
    await markDocument(page);

    // useSearchParams' setter adds ?history=1; back removes it again.
    await page.getByRole('button', { name: /^Show \d+ completed formula runs\.$/ }).click();
    await expect(page).toHaveURL(
      (url) => url.pathname === `${CITY_BASE}/runs` && url.searchParams.get('history') === '1',
    );
    await expect(page.getByRole('region', { name: ru('Historical runs') })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(
      (url) => url.pathname === `${CITY_BASE}/runs` && !url.searchParams.has('history'),
    );
    await expect(page.getByRole('region', { name: ru('Historical runs') })).toHaveCount(0);
    await expectSameDocument(page);

    // A lane links to its run detail with the run's scope in the query string.
    await page.locator('main').getByRole('link', { name: ANCHOR_FORMULA }).first().click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === `${CITY_BASE}/runs/${ANCHOR_RUN_ID}` &&
        url.searchParams.get('scope_kind') === 'city' &&
        url.searchParams.get('scope_ref') === CITY_NAME,
    );
    await expect(page.getByRole('heading', { name: ANCHOR_FORMULA, level: 1 })).toBeVisible();
    await expectSameDocument(page);

    // The detail page's breadcrumb returns to the list (the run page's
    // breadcrumb is not translated yet: it reads «Runs»).
    await page.locator('main').getByRole('link', { name: 'Runs', exact: true }).click();
    await expect(page).toHaveURL(inCity('/runs'));
    await expect(page.getByRole('heading', { name: ru('Runs'), level: 1 })).toBeVisible();
    await expectSameDocument(page);
  });

  test('bare deep link keeps the bead', async ({ page }) => {
    // B1 / RB13: a city-less link the Mayor sends lands on the same card.
    await page.goto(`/beads?bead=${REVIEW_BEAD_ID}`);
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === `${CITY_BASE}/beads` && url.searchParams.get('bead') === REVIEW_BEAD_ID,
    );
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: REVIEW_BEAD_TITLE }),
    ).toBeVisible();
  });

  test('an unknown in-app path renders the catch-all route and the nav recovers', async ({
    page,
  }) => {
    await gotoCityRoute(page, CITY_BASE, '/no-such-route');
    await expect(page.getByRole('heading', { name: ru('Page not found'), level: 1 })).toBeVisible();
    await markDocument(page);

    await (await allPages(page)).getByRole('link', { name: startsWith('Agents') }).click();
    await expect(page).toHaveURL(inCity('/agents'));
    await expect(page.getByRole('heading', { name: ru('Agents'), level: 1 })).toBeVisible();
    await expectSameDocument(page);
  });
});
