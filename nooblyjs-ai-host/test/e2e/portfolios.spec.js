// Portfolios and products on the Product board, in a real browser: the board filters by portfolio, then value stream,
// then product; a portfolio and a product are labels a person types and adds (no drop-downs); a new idea is
// filed by pressing labels; an Approver renames a product and everything under it follows. The Portfolios page shows
// the strategic themes, portfolios and value streams, and each one's document made from its template (Settings).
// With axe and phone width. nooblyjs-ai-product's test/routes/catalogue.test.js and strategy.test.js cover the rules
// through the API.
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

test('the board filters by portfolio, then by value stream and product within it', async ({ page }) => {
  await signIn(page, 'lerato-m');
  await page.goto('/product/board');
  const filters = content(page).getByRole('navigation', { name: 'Filter the board' });
  await expect(filters.getByRole('link', { name: /Digital/ })).toContainText('13');
  await expect(filters.getByRole('link', { name: /Buying/ })).toContainText('0');
  await filters.getByRole('link', { name: /Digital/ }).click();
  const streams = content(page).getByRole('navigation', { name: 'Value streams in Digital' });
  await expect(streams.getByRole('link', { name: /Rewards/ })).toContainText('2');
  await streams.getByRole('link', { name: /Digital Commerce/ }).click();
  await expect(page).toHaveURL(/valueStream=Digital%20Commerce/);
  const products = content(page).getByRole('navigation', { name: 'Products in Digital Commerce' });
  await expect(products.getByRole('link', { name: /Delivery/ })).toContainText('5');
  await products.getByRole('link', { name: /Delivery/ }).click();
  await expect(page).toHaveURL(/product=Delivery/);
  await expect(content(page).locator('.kanban__card')).toHaveCount(5);
  await expectNoAxeViolations(page, 'Board filtered to a product');
});

test('labels are typed and added: a portfolio, a product in it, and a new idea filed by pressing them', async ({ page }) => {
  await signIn(page, 'priya-s');
  await page.goto('/product/board');
  await content(page).getByRole('button', { name: 'Portfolios & products' }).click();
  const panel = content(page).getByRole('region', { name: 'Portfolios & products' });
  await expect(panel).toContainText('3 portfolios · 8 products');
  // No drop-down anywhere in the panel.
  await expect(panel.locator('select')).toHaveCount(0);
  await panel.getByLabel('Add a portfolio', { exact: true }).fill('Pharmacy');
  await panel.getByRole('button', { name: 'Add portfolio' }).click();
  await expect(content(page).getByRole('status')).toContainText('Pharmacy is a portfolio now. Add its products.');
  const box = content(page).getByLabel('Add a product to Pharmacy');
  await expect(box).toBeFocused();
  await box.fill('Prescriptions');
  await box.press('Enter');
  await expect(content(page).getByRole('status')).toContainText('Prescriptions is a product in Pharmacy now.');
  await expectNoAxeViolations(page, 'Portfolios & products panel');
  await page.setViewportSize({ width: 375, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1280, height: 720 });

  await content(page).getByRole('button', { name: 'New idea' }).click();
  const form = content(page).locator('[data-form="new-idea"]');
  await expect(form.locator('select')).toHaveCount(0);
  await form.getByLabel('Title').fill('Repeat prescriptions');
  await form.getByRole('button', { name: 'Pharmacy', exact: true }).click();
  await expect(form.getByRole('button', { name: 'Prescriptions', exact: true })).toBeVisible();
  await expect(form.getByRole('button', { name: 'Delivery', exact: true })).toBeHidden();
  await form.getByRole('button', { name: 'Prescriptions', exact: true }).click();
  await expect(form.getByRole('button', { name: 'Prescriptions', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expectNoAxeViolations(page, 'New idea with label pickers');
  await form.getByRole('button', { name: 'Create idea' }).click();
  await expect(content(page).getByRole('status')).toContainText('was added to Ideas, in Prescriptions (Pharmacy).');
  await expect(content(page).getByRole('navigation', { name: 'Filter the board' }).getByRole('link', { name: /Pharmacy/ })).toContainText('1');
});

test('an Approver renames a product and its work follows; a Contributor cannot', async ({ page }) => {
  await signIn(page, 'lerato-m');
  await page.goto('/product/board');
  await content(page).getByRole('button', { name: 'Portfolios & products' }).click();
  const panel = content(page).getByRole('region', { name: 'Portfolios & products' });
  await panel.getByRole('button', { name: /^Search/ }).click();
  const edit = content(page).getByRole('form', { name: 'Change Search' });
  await edit.getByLabel('Name').fill('Search & browse');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(content(page).getByRole('status')).toContainText('Search & browse was saved.');
  await page.goto('/product/board?product=Search%20%26%20browse');
  await expect(content(page).locator('.kanban__card')).toHaveCount(2);
});

test('a Contributor says where a product is built: repositories from Platform and a Jira project, as labels; a new idea starts with them', async ({ page }) => {
  await signIn(page, 'priya-s');
  await page.goto('/product/board');
  await content(page).getByRole('button', { name: 'Portfolios & products' }).click();
  const panel = content(page).getByRole('region', { name: 'Portfolios & products' });
  await panel.getByRole('button', { name: /^Checkout/ }).click();
  const form = content(page).getByRole('form', { name: 'Change Checkout' });
  // A Contributor cannot rename, move or remove, only say where it is built.
  await expect(form.getByLabel('Name')).toHaveCount(0);
  await expect(form.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  await expect(form.locator('select')).toHaveCount(0);
  await form.getByRole('button', { name: 'acme/web-storefront', exact: true }).click();
  await form.getByRole('button', { name: 'acme/payments-gateway', exact: true }).click();
  await form.getByRole('button', { name: 'DTE', exact: true }).click();
  await expect(form.getByRole('button', { name: 'DTE', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expectNoAxeViolations(page, 'Where a product is built');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(content(page).getByRole('status')).toContainText('Checkout was saved.');
  await expect(panel.getByRole('button', { name: /^Checkout/ })).toContainText('web-storefront · payments-gateway · Jira DTE');

  const res = await page.request.post('/product/api/v1/ideas', {
    data: { title: 'Saved cards at checkout', product: 'Checkout' },
    headers: { 'x-csrf-token': (await page.context().cookies()).find((c) => c.name === 'noobly.csrf')?.value ?? '' },
  });
  expect(res.status()).toBe(201);
  const opp = await res.json();
  expect([opp.repositories, opp.jiraProject]).toEqual([['acme/web-storefront', 'acme/payments-gateway'], 'DTE']);
});

test('the Portfolios page: themes, portfolios and value streams; a document filled in from its template; the templates in Settings', async ({ page }) => {
  await signIn(page, 'lerato-m');
  await page.goto('/product/portfolios');
  const themes = content(page).locator('section.card', { has: page.getByRole('heading', { name: 'Strategic themes' }) });
  await expect(themes).toContainText('Solve the every day');
  await expect(themes).toContainText('Leverage AI');
  await expectNoAxeViolations(page, 'Portfolios');

  await content(page).getByLabel('Add a value stream to Banking').fill('Lending');
  await content(page).getByLabel('Add a value stream to Banking').press('Enter');
  await expect(content(page).getByRole('status')).toContainText('Lending is a value stream in Banking now, with its document.');

  await content(page).getByRole('link', { name: 'Digital', exact: true }).click();
  await expect(content(page).locator('h1')).toHaveText('Digital');
  await expect(content(page).locator('.pf-section__title')).toHaveText(['Key Partners', 'Key Activities', 'Key Resources', 'Cost Structure', 'Revenue Streams']);
  await content(page).getByRole('button', { name: 'Edit' }).click();
  await content(page).getByLabel(/Key Partners/).fill('Payment providers and delivery partners.');
  await expectNoAxeViolations(page, 'Editing a portfolio document');
  await content(page).getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect(content(page).getByRole('status')).toContainText('Digital is saved as version 2.');
  await expect(content(page).locator('.lead')).toContainText('1 of 5 sections filled in');

  await page.goto('/product/value-streams/vs_rewards');
  await expect(content(page).locator('.pf-section__title')).toHaveCount(10);
  await page.setViewportSize({ width: 375, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto('/product/settings');
  await expect(content(page).getByRole('heading', { name: 'Value stream template' })).toBeVisible();
  await expectNoAxeViolations(page, 'Settings');
});
