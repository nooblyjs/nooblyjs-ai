// Phase 11 in a real browser: where an item is built (Architecture's Repositories card), the item's Jira card, and
// Platform · Settings · Integrations, with axe and phone width. The e2e NooblyJS has no Jira or Bitbucket credentials, so
// these screens show the not-connected state; test/devtools.test.js covers the connected one with a fake Atlassian.
// Nothing here reaches Jira or Bitbucket.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const content = (page) => page.locator('#noobly-content');

async function signIn(page, personId) {
  await page.goto('/login');
  await page.locator(`button[name="personId"][value="${personId}"]`).click();
  await expect(content(page).locator('h1')).toBeVisible();
}
async function expectNoAxeViolations(page, label) {
  const result = await new AxeBuilder({ page }).include('#noobly-content').withTags(AA).analyze();
  const summary = result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')})`);
  expect(summary, `axe on ${label}`).toEqual([]);
}

test('Architecture · Repositories: search Platform\'s repositories, add them, remove one; the handoff then names them', async ({ page }) => {
  await signIn(page, 'priya-s');
  await page.goto('/factory/product/architecture/PRD-031');
  await content(page).getByRole('tab', { name: 'Repositories' }).click();
  const mine = content(page).getByRole('region', { name: 'Repositories for PRD-031' });
  await expect(mine).toContainText('None yet');
  // Not on the Diagram tab any more.
  await expect(content(page).getByRole('tab', { name: 'Repositories' })).toHaveAttribute('aria-selected', 'true');

  const add = content(page).getByRole('region', { name: 'Add a repository' });
  const search = add.getByRole('searchbox', { name: 'Search repositories' });
  await search.fill('slots');
  await expect(add.getByRole('list', { name: 'Repositories you can add' }).getByRole('listitem')).toHaveCount(1);
  await add.getByRole('button', { name: 'Add acme/slots-api' }).click();
  await expect(content(page).getByRole('status')).toContainText('Added acme/slots-api to PRD-031.');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('slots');
  await expect(add).toContainText('No repository in Platform matches', { useInnerText: true });

  for (const [q, name] of [['storefront', 'acme/web-storefront'], ['mobile', 'acme/mobile-app'], ['payments', 'acme/payments-gateway']]) {
    await search.fill(q);
    await add.getByRole('button', { name: `Add ${name}` }).click();
    await expect(content(page).getByRole('status')).toContainText(`Added ${name}`);
  }
  await expect(mine.getByRole('listitem')).toHaveCount(4);
  await expectNoAxeViolations(page, 'Architecture · Repositories');

  await mine.getByRole('button', { name: 'Remove acme/payments-gateway' }).click();
  await expect(content(page).getByRole('status')).toContainText('Removed acme/payments-gateway from PRD-031.');
  await expect(mine.getByRole('listitem')).toHaveCount(3);
  await expect(mine).toContainText('3 repositories, confirmed by');

  // design-system's work item is outside the three, so the handoff says so until it is added.
  await page.goto('/factory/product/ui/PRD-031');
  await expect(content(page)).toContainText('Built in slots-api, web-storefront, mobile-app (Architecture).');
  await expect(content(page)).toContainText("design-system is not among the item's repositories");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/factory/product/architecture/PRD-031');
  await content(page).getByRole('tab', { name: 'Repositories' }).click();
  await expect(content(page).getByRole('region', { name: 'Add a repository' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test('an item shows its Jira card; without Jira connected it says so and the page still works', async ({ page }) => {
  await signIn(page, 'stevie');
  await page.goto('/home/lifecycle/PRD-031');
  const jira = content(page).getByRole('region', { name: 'Jira' }).or(content(page).locator('section.card', { hasText: 'No Jira issues linked yet' }));
  await expect(jira).toContainText('No Jira issues linked yet.');
  await expect(jira).toContainText("Linking keeps the issue's key here and changes nothing in Jira.");
  await content(page).getByLabel(/Link a Jira issue/).fill('DTE-60');
  await content(page).getByRole('button', { name: 'Find' }).click();
  await expect(content(page).locator('.flash--error')).toContainText(/Jira/);
  await expectNoAxeViolations(page, 'Item with its Jira card');
});

test('Integrations lists Bitbucket and Jira; at phone width the new screens do not scroll sideways', async ({ page }) => {
  await signIn(page, 'stevie');
  await page.goto('/platform/settings');
  await page.locator('[data-tab="integrations"]').click();
  const table = content(page).getByRole('region', { name: 'Integrations' }).last();
  await expect(table).toContainText('Bitbucket');
  await expect(table).toContainText('Not connected: set JIRA_SITE, JIRA_USERNAME and JIRA_API_TOKEN.');
  await expect(table).not.toContainText('GitHub');
  await expectNoAxeViolations(page, 'Integrations');

  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ['/platform/settings', '/platform/repositories/acme__slots-api', '/home/lifecycle/PRD-031', '/factory/product/architecture/PRD-031']) {
    await page.goto(path);
    await expect(content(page).locator('h1')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
  }
});

// Phase 13: writing to Jira and Bitbucket. The e2e NooblyJS may not write (DEVTOOLS_WRITES is not set), so this is the
// Record only state, which is also what a new installation shows.
test('Integrations shows writing as Record only, the rule for each kind of write, and asks before an Owner switches to Send', async ({ page }) => {
  await signIn(page, 'stevie');
  await page.goto('/platform/settings');
  await page.locator('[data-tab="integrations"]').click();
  const writing = content(page).getByRole('region', { name: 'Writing to Jira and Bitbucket' });
  await expect(writing).toContainText('This NooblyJS is not allowed to write');
  await expect(writing.getByText('Record only', { exact: true })).toHaveCount(2);
  for (const kind of ['Create a Jira issue', 'Move a Jira issue', 'Comment on a Jira issue', 'Push a factory branch', 'Open a pull request']) await expect(writing).toContainText(kind);
  await expect(writing).toContainText('NooblyJS has no write that merges, deletes or changes a setting.');
  // Switching to Send is two steps, and Cancel leaves it as it was.
  await writing.getByRole('button', { name: 'Switch to Send' }).first().click();
  await expect(writing).toContainText('Let NooblyJS write to Jira?');
  await expectNoAxeViolations(page, 'Integrations, confirming Send');
  await writing.getByRole('button', { name: 'Cancel' }).click();
  await expect(writing).not.toContainText('Let NooblyJS write to Jira?');
  await expect(writing.getByText('Record only', { exact: true })).toHaveCount(2);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/platform/settings');
  await page.locator('[data-tab="integrations"]').click();
  await expect(content(page).getByRole('region', { name: 'Writing to Jira and Bitbucket' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'Integrations scrolls sideways at phone width').toBeLessThanOrEqual(0);
});

test('a Contributor sees how writing is set but cannot change it', async ({ page }) => {
  await signIn(page, 'priya-s');
  await page.goto('/platform/settings');
  await page.locator('[data-tab="integrations"]').click();
  const writing = content(page).getByRole('region', { name: 'Writing to Jira and Bitbucket' });
  await expect(writing).toContainText('Record only');
  await expect(writing.getByRole('button', { name: 'Switch to Send' })).toHaveCount(0);
  await expect(writing.locator('select')).toHaveCount(0);
});
