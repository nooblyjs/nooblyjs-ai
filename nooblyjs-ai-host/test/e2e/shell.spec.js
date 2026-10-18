// The NooblyJS shell in a real browser (roadmap Phase 1, steps 2–7): every rail and sidebar item, active states, no
// reload between apps, deep links, the error card, phone width, keyboard focus, and WCAG 2.2 AA with axe.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function signIn(page, personId) {
  await page.goto('/login');
  await page.locator(`button[name="personId"][value="${personId}"]`).click();
  // A person with no profile yet (Naledi, when this file runs on its own) is sent to onboarding: skip it.
  await page.waitForLoadState('domcontentloaded');
  if (page.url().includes('/onboarding')) await page.locator('#onboarding').getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.locator('#noobly-content h1')).toBeVisible();
}

async function expectNoAxeViolations(page, label) {
  const result = await new AxeBuilder({ page }).withTags(AA).analyze();
  const summary = result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')})`);
  expect(summary, `axe on ${label}`).toEqual([]);
}

test('the sign-in page has no AA violations', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Who are you today?');
  await expectNoAxeViolations(page, '/login');
});

test('every rail and sidebar item goes somewhere, shows its active state, and passes axe', async ({ page }) => {
  test.setTimeout(240_000); // about 30 pages, each scanned by axe
  await signIn(page, 'stevie');
  const railNames = await page.locator('#noobly-rail .rail__item').evaluateAll((els) => els.map((e) => e.dataset.app));
  expect(railNames).toEqual(['home', 'product', 'factory', 'infrastructure', 'teammates', 'wiki', 'hello-app', 'throwing-app', 'platform']);

  const visited = [];
  for (const name of railNames) {
    if (name === 'throwing-app') continue; // its own test below
    await page.locator(`#noobly-rail [data-app="${name}"]`).click();
    await expect(page.locator(`#noobly-rail [data-app="${name}"]`)).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#noobly-content h1')).toBeVisible();
    const navKeys = await page.locator('#noobly-sidebar .nav__item').evaluateAll((els) => els.map((e) => e.dataset.nav));
    if (!navKeys.length) {
      await expect(page.locator('#noobly-content')).toContainText(/isn't installed yet|Hello,/);
      await expectNoAxeViolations(page, name);
      visited.push(name);
      continue;
    }
    for (const key of navKeys) {
      await page.locator(`#noobly-sidebar [data-nav="${key}"]`).click();
      await expect(page.locator(`#noobly-sidebar [data-nav="${key}"]`)).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('#noobly-content h1')).toBeVisible();
      await expect(page.locator('#noobly-content')).not.toContainText('Page not found');
      await expect(page.locator(`#noobly-rail [data-app="${name}"]`)).toHaveAttribute('aria-current', 'page');
      await expectNoAxeViolations(page, `${name} / ${key}`);
      visited.push(`${name}/${key}`);
    }
  }
  expect(visited.length).toBeGreaterThan(20);
});

test('every Home screen is built: Metrics, the last placeholder, is a real page', async ({ page }) => {
  await signIn(page, 'lerato-m');
  await page.locator('#noobly-rail [data-app="home"]').click();
  await page.locator('#noobly-sidebar [data-nav="metrics"]').click();
  await expect(page.locator('#noobly-content h1')).toHaveText('Metrics');
  await expect(page.locator('#noobly-content')).not.toContainText('Not built yet');
  await expect(page).toHaveTitle('Metrics · Home · NooblyJS');
});

test('switching apps never reloads the page, and the sidebar follows', async ({ page }) => {
  await signIn(page, 'thabo-n');
  await page.evaluate(() => { window.__nooblyNoReload = 'still here'; });
  for (const name of ['product', 'hello-app', 'platform', 'home']) {
    await page.locator(`#noobly-rail [data-app="${name}"]`).click();
    await expect(page.locator(`#noobly-rail [data-app="${name}"]`)).toHaveAttribute('aria-current', 'page');
  }
  await expect(page.locator('#noobly-sidebar .sidebar__title')).toHaveText('noobly');
  expect(await page.evaluate(() => window.__nooblyNoReload)).toBe('still here');
  expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(1);
  await page.goBack();
  await expect(page.locator('#noobly-rail [data-app="platform"]')).toHaveAttribute('aria-current', 'page');
});

test('a deep link loads the same screen after a refresh, with the chat slot for an item', async ({ page }) => {
  await signIn(page, 'lerato-m');
  await page.goto('/product/specs/PRD-031');
  // The Spec page (nooblyjs-ai-product) is titled with the spec's name, as in its mockup.
  await expect(page.locator('#noobly-content h1')).toHaveText('Same-day delivery slots');
  await expect(page.locator('#noobly-chat')).toBeVisible();
  await expect(page.locator('#noobly-chat')).toContainText('Team chat');
  await page.reload();
  // The Spec page (nooblyjs-ai-product) is titled with the spec's name, as in its mockup.
  await expect(page.locator('#noobly-content h1')).toHaveText('Same-day delivery slots');
  await expect(page.locator('#noobly-sidebar [data-nav="specs"]')).toHaveAttribute('aria-current', 'page');
  await page.locator('#noobly-sidebar [data-nav="architecture"]').click();
  await expect(page.locator('#noobly-chat')).toBeHidden();
});

test('the hosted stub app renders inside the frame', async ({ page }) => {
  await signIn(page, 'priya-s');
  await page.goto('/hello/');
  await expect(page.locator('#noobly-content h1')).toHaveText('Hello, Priya S.');
  await expect(page.locator('#noobly-content')).toHaveAttribute('data-module', 'hello-app');
  await expect(page.locator('#noobly-rail [data-app="hello-app"]')).toHaveAttribute('aria-current', 'page');
});

test('a module that fails shows an error card, and the rest of NooblyJS keeps working', async ({ page }) => {
  page.on('pageerror', () => {}); // the import failure is expected
  await signIn(page, 'stevie');
  await page.locator('#noobly-rail [data-app="throwing-app"]').click();
  await expect(page.getByRole('alert')).toContainText("Throwing couldn't load this page");
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.locator('#noobly-rail [data-app="product"]').click();
  await expect(page.locator('#noobly-content h1')).toHaveText('Product Factory');
  await expectNoAxeViolations(page, 'after the error');
});

test('at phone width there is no horizontal scroll and controls stay at least 44px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, 'stevie');
  for (const path of ['/', '/home/lifecycle', '/product/specs/PRD-031', '/product/architecture/PRD-031', '/product/ux/PRD-031', '/product/ui/PRD-031', '/platform/settings', '/dev/styleguide', '/factory']) {
    await page.goto(path);
    await expect(page.locator('#noobly-content h1')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
    const small = await page.locator('.rail__item, .nav__item, .btn, .person__out').evaluateAll((els) => els
      .filter((e) => e.offsetParent !== null)
      .map((e) => ({ text: e.textContent.trim().slice(0, 20), h: e.getBoundingClientRect().height }))
      .filter((r) => r.h < 44));
    expect(small, `${path}: controls under 44px`).toEqual([]);
  }
});

test('keyboard: the skip link comes first and jumps to the content; focus is visible', async ({ page }) => {
  await signIn(page, 'stevie');
  await page.goto('/home/overview');
  await expect(page.locator('#noobly-content h1')).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.locator('.skip-link');
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('#noobly-content')).toBeFocused();
  await page.locator('#noobly-sidebar [data-nav="lifecycle"]').focus();
  const outline = await page.locator('#noobly-sidebar [data-nav="lifecycle"]').evaluate((e) => getComputedStyle(e).outlineStyle);
  expect(outline).not.toBe('none');
});

test('the styleguide shows every component and passes axe', async ({ page }) => {
  await signIn(page, 'stevie');
  await page.goto('/dev/styleguide');
  for (const heading of ['Colour', 'Type', 'Buttons', 'Status pills', 'Stat cards', 'List rows', 'Data table', 'Kanban columns',
    'Timeline', 'Meters', 'Process chevrons', 'Stage strip', 'Swimlane', 'Checklist', 'Notices', 'Icons']) {
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  await expectNoAxeViolations(page, '/dev/styleguide');
});

// ---- nooblyjs-ai-teammate in the frame: the pattern for every hosted app (roadmap hosted-app checklist) ----

test('Teammates loads into the frame: roster to profile and back with no reload, in NooblyJS type', async ({ page }) => {
  await signIn(page, 'lerato-m');
  await page.evaluate(() => { window.__nooblyNoReload = 'still here'; });
  await page.locator('#noobly-rail [data-app="teammates"]').click();
  await expect(page).toHaveURL(/\/teammates\/team$/);
  await expect(page.locator('#noobly-content')).toHaveAttribute('data-module', 'teammates');
  await expect(page.locator('#noobly-sidebar [data-nav="team"]')).toHaveAttribute('aria-current', 'page');
  const card = page.locator('#noobly-content a.tmk-card').first();
  await expect(card).toBeVisible();
  // The roster is built from the kit's components, so it is in NooblyJS type.
  expect(await page.locator('#noobly-content h1').evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/Lexend/);
  await card.click();
  await expect(page).toHaveURL(/\/teammates\/team\/[a-z0-9-]+$/);
  await expect(page.locator('#noobly-sidebar [data-nav="profiles"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#noobly-content h1')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#noobly-content a.tmk-card').first()).toBeVisible();
  await page.locator('#noobly-rail [data-app="product"]').click();
  await expect(page.locator('#noobly-content h1')).toHaveText('Product Factory');
  expect(await page.evaluate(() => window.__nooblyNoReload)).toBe('still here');
  expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(1);
});

test('Teammates pages follow the NooblyJS matrix: a Viewer gets "Not for your role" on Owner pages', async ({ page }) => {
  await signIn(page, 'naledi-k');
  await page.goto('/teammates/settings');
  await expect(page.locator('#noobly-content h1')).toHaveText('Not for your role');
  await expect(page.locator('#noobly-sidebar [data-nav="settings"]')).toHaveCount(0);
  await page.goto('/teammates/team');
  await expect(page.locator('#noobly-content a.tmk-card').first()).toBeVisible();
  // Manager-only controls are hidden for a Viewer (the API refuses them too).
  await expect(page.locator('#noobly-content .tm-kit')).not.toHaveClass(/can-manage/);
});

test('Teammates at phone width: no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, 'stevie');
  for (const path of ['/teammates/team', '/teammates/billing', '/teammates/timeline']) {
    await page.goto(path);
    await expect(page.locator('#noobly-content h1')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
  }
});
