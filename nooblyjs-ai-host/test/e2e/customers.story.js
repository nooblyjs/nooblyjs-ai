// Phases 25a–26 in a real browser, in order on one NooblyJS (each test builds on the last): Feedback (a note, Ada's
// suggestion accepted), the feedback form signed out, the ideas portal, the board's why line, Objectives, the Roadmap
// with capacity and a read-only saved view, products and a strategy document on the Portfolios page, team capacity on
// Teams & roles, the Product card on Metrics, the PM's customer evidence, and Ines Tau's draft of INF-031. Each page
// passes axe (WCAG 2.2 AA) and has no sideways scroll at phone width.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const content = (page) => page.locator('#noobly-content');
const status = (page) => content(page).locator('[data-message]');
let formUrl = null;

async function signIn(page, personId) {
  await page.goto('/login');
  await page.locator(`button[name="personId"][value="${personId}"]`).click();
  await page.waitForLoadState('networkidle');
  // Naledi has no profile yet: onboarding comes first.
  if (page.url().includes('/onboarding')) await page.locator('#onboarding').getByRole('button', { name: 'Skip for now' }).click();
  await expect(content(page).locator('h1')).toBeVisible();
}
async function axe(page, label, scope = '#noobly-content') {
  const result = await new AxeBuilder({ page }).include(scope).withTags(AA).analyze();
  const summary = result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')})`);
  expect(summary, `axe on ${label}`).toEqual([]);
}
async function phoneWidth(page, label) {
  await page.setViewportSize({ width: 375, height: 800 });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${label} scrolls sideways at 375px`).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1280, height: 800 });
}

test.describe.configure({ mode: 'serial' });

test('Feedback: Lerato logs a note, asks Ada, accepts her suggestion as critical, and makes a feedback link', async ({ page }) => {
  await signIn(page, 'lerato-m');
  await page.goto('/product/feedback');
  await expect(content(page).locator('h1')).toHaveText('Feedback');
  await content(page).getByRole('button', { name: 'Log a note' }).click();
  const log = content(page).getByRole('form', { name: 'Log a note' });
  await log.getByLabel('What they said').fill('Every same-day slot sells out before 10:00, so after-work shoppers get nothing.');
  await log.getByLabel(/Who said it/).fill('Store manager, Sandton');
  await log.getByLabel('Product').selectOption('Delivery');
  await log.getByRole('button', { name: 'Log it' }).click();
  await expect(status(page)).toHaveText('NOTE-0001 is logged.');
  await content(page).getByRole('button', { name: 'Ask Ada to suggest links' }).click();
  await expect(status(page)).toContainText('Ada Quill suggested links for 1 of 1 note.');
  const suggestion = content(page).locator('[data-form="decide"]').first();
  await expect(suggestion).toContainText('PRD-031');
  await suggestion.getByLabel('How much it matters').selectOption('critical');
  await axe(page, 'Feedback with a suggestion');
  await suggestion.getByRole('button', { name: 'Accept' }).click();
  await expect(status(page)).toContainText('Accepted: NOTE-0001 is evidence for PRD-031.');
  await expect(content(page).locator('#NOTE-0001')).toContainText('Critical');
  // A feedback form link for Delivery.
  await content(page).locator('[data-form="new-link"] select[name="product"]').selectOption('Delivery');
  await content(page).locator('[data-form="new-link"]').getByRole('button', { name: 'Make a link' }).click();
  await expect(status(page)).toContainText('Anyone with this link can now send feedback on Delivery');
  formUrl = (await status(page).textContent()).match(/https?:\/\/\S+/)[0];
  await axe(page, 'Feedback');
  await phoneWidth(page, 'Feedback');
});

test('the feedback form, signed out, in another browser: a phone-width page that takes the feedback', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const page = await context.newPage();
  await page.goto(formUrl);
  await expect(page.locator('h1')).toHaveText('Feedback on Delivery');
  await expect(page.locator('body')).not.toContainText('NooblyJS');
  await axe(page, 'the feedback form', 'body');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.getByLabel('Your feedback').fill('Slots were gone by 9am again');
  await page.getByRole('button', { name: 'Send feedback' }).click();
  await expect(page.locator('h1')).toHaveText("Thanks, we've got it");
  await axe(page, 'the form\'s thanks', 'body');
  await context.close();
});

test('the ideas portal: put an idea forward, vote, vote on behalf of a colleague, comment; the vote count sits beside the idea', async ({ page }) => {
  await signIn(page, 'naledi-k');
  await page.goto('/product/portal');
  await expect(content(page).locator('h1')).toHaveText('Ideas portal');
  await content(page).getByRole('button', { name: 'Put an idea forward' }).click();
  const form = content(page).getByRole('form', { name: 'Put an idea forward' });
  await form.getByLabel('Your idea').fill('Let me add to my order after paying');
  await form.getByLabel('Product').selectOption('Checkout');
  await form.getByRole('button', { name: 'Put it forward' }).click();
  await expect(status(page)).toContainText('is in the portal');
  const card = content(page).locator('.pf-portal__idea', { hasText: 'Let me add to my order after paying' });
  await card.getByRole('button', { name: /^Vote for/ }).click();
  await expect(status(page)).toContainText('You have 9 votes left.');
  const again = content(page).locator('.pf-portal__idea', { hasText: 'Let me add to my order after paying' });
  await again.getByText('Vote on behalf of a colleague who asked you').click();
  await again.getByLabel('Their name').fill('Store manager, Sandton');
  await again.getByRole('button', { name: 'Vote for them' }).click();
  await expect(status(page)).toContainText('on behalf of Store manager, Sandton');
  const third = content(page).locator('.pf-portal__idea', { hasText: 'Let me add to my order after paying' });
  await third.getByLabel('Comment', { exact: true }).fill('I forget the milk every week.');
  await third.getByRole('button', { name: 'Add' }).click();
  await expect(status(page)).toHaveText('Comment added.');
  // CHG: the vote count is beside the idea, not above it.
  const idea = content(page).locator('.pf-portal__idea', { hasText: 'Let me add to my order after paying' });
  const votes = await idea.locator('.pf-portal__votes').boundingBox();
  const body = await idea.locator('.pf-portal__body').boundingBox();
  expect(votes.x + votes.width).toBeLessThanOrEqual(body.x + 1);
  await expect(idea.locator('.pf-portal__votes')).toContainText('2');
  await axe(page, 'Ideas portal');
  await phoneWidth(page, 'Ideas portal');
});

test('Objectives: Lerato sets OBJ-04 with a typed key result, and PRD-031 serves it', async ({ page }) => {
  await signIn(page, 'lerato-m');
  await page.goto('/product/objectives');
  await expect(content(page).locator('h1')).toHaveText('Objectives');
  await content(page).getByRole('button', { name: 'Set an objective' }).click();
  const form = content(page).getByRole('form', { name: 'Set an objective' });
  await form.getByLabel('Objective').fill('More same-day orders');
  await form.getByLabel('Solve the every day').check();
  await form.getByRole('button', { name: 'Set it' }).click();
  await expect(status(page)).toHaveText('OBJ-04 is set, in Now. Add its key results.');
  const card = content(page).locator('#OBJ-04');
  await card.getByText('Add a key result').click();
  await card.getByLabel('Measure').fill('Same-day slots still open at 12:00');
  await card.getByLabel('Starts at').fill('18%');
  await card.getByLabel('Target').fill('45%');
  await card.getByLabel('Read from').selectOption('typed');
  await card.getByRole('button', { name: 'Add the key result' }).click();
  await expect(status(page)).toHaveText('The key result is added to OBJ-04.');
  await content(page).locator('#OBJ-04 [data-form="link"] select').selectOption('PRD-031');
  await content(page).locator('#OBJ-04 [data-form="link"]').getByRole('button', { name: 'Link' }).click();
  await expect(status(page)).toHaveText('PRD-031 serves OBJ-04.');
  await expect(content(page).locator('#OBJ-04')).toContainText('PRD-031 Same-day delivery slots');
  await axe(page, 'Objectives');
  await phoneWidth(page, 'Objectives');
});

test('the board: PRD-031\'s card says why it is there', async ({ page }) => {
  await signIn(page, 'lerato-m');
  await page.goto('/product/board?product=Delivery');
  const card = content(page).locator('.kanban__card', { hasText: 'PRD-031' });
  await expect(card.locator('.pf-evidence')).toHaveText('serves OBJ-04 (Now) · 1 colleague asked');
  await axe(page, 'Board with why lines');
});

test('the Roadmap: capacity in Now, moving PRD-027 to Next, and a saved view\'s read-only page', async ({ page }) => {
  await signIn(page, 'lerato-m');
  await page.goto('/product/roadmap');
  await expect(content(page).locator('h1')).toHaveText('Roadmap');
  const capacity = content(page).locator('section.card', { hasText: 'Capacity in Now' });
  await expect(capacity).toContainText('Delivery squad: 64 of 50 days planned in Now, 14 over');
  await expect(capacity).toContainText('Over-planned');
  await axe(page, 'Roadmap');
  await content(page).locator('#rm-PRD-027 select[name="horizon"]').selectOption('next');
  await content(page).locator('#rm-PRD-027').getByRole('button', { name: 'Move' }).click();
  await expect(status(page)).toHaveText('PRD-027 is in Next now.');
  await expect(capacity).toContainText('Delivery squad: 54 of 50 days planned in Now, 4 over');
  await phoneWidth(page, 'Roadmap');
  await content(page).getByLabel('Save this view as').fill('Everything, by horizon');
  await content(page).getByRole('button', { name: 'Save view' }).click();
  await expect(status(page)).toContainText('Saved "Everything, by horizon"');
  await content(page).getByRole('link', { name: 'Everything, by horizon' }).click();
  await expect(content(page).locator('h1')).toHaveText('Everything, by horizon');
  await expect(content(page).getByRole('button', { name: 'Move' })).toHaveCount(0);
  await expect(content(page).locator('#rm-PRD-027')).toBeVisible();
  await axe(page, 'a saved roadmap view');
});

test('Portfolios: a product added to a value stream, and a persona started and filled in', async ({ page }) => {
  await signIn(page, 'lerato-m');
  await page.goto('/product/portfolios');
  await content(page).getByLabel('Add a product to Rewards').fill('Vouchers');
  await content(page).getByLabel('Add a product to Rewards').press('Enter');
  await expect(status(page)).toContainText('Vouchers is a product in Rewards now.');
  const strategy = content(page).locator('section.card', { hasText: 'Product strategy' });
  await strategy.getByLabel('Kind').selectOption('persona');
  await strategy.getByLabel('Name').fill('After-work shopper');
  await strategy.getByRole('button', { name: 'Start it' }).click();
  await expect(status(page)).toContainText('The persona "After-work shopper" is started');
  await axe(page, 'Portfolios with products and strategy');
  await phoneWidth(page, 'Portfolios');
  await content(page).getByRole('link', { name: 'After-work shopper' }).click();
  await expect(content(page).locator('h1')).toHaveText('After-work shopper');
  await content(page).getByRole('button', { name: 'Edit' }).click();
  await content(page).getByLabel(/^Goals/).fill('Get groceries home the same evening.');
  await content(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(content(page)).toContainText('Get groceries home the same evening.');
  await axe(page, 'a strategy document');
});

test('Teams & roles: Stevie sets the Platform team\'s people-days; Metrics has the Product card', async ({ page }) => {
  await signIn(page, 'stevie');
  await page.goto('/home/teams');
  const platform = content(page).locator('[data-form="capacity"][data-team="platform-team"]');
  await platform.getByLabel('People-days in Now').fill('35');
  await platform.getByRole('button', { name: 'Save' }).click();
  await expect(content(page).locator('.flash')).toHaveText('Platform team: 35 people-days in Now.');
  await axe(page, 'Teams & roles with capacity');
  await page.goto('/home/metrics');
  const productCard = content(page).locator('section[aria-label="Product"]');
  await expect(productCard).toContainText('Feedback by portfolio');
  await expect(productCard).toContainText('OBJ-04 More same-day orders');
  await axe(page, 'Metrics with the Product card');
});

test('For you: the PM sees customer evidence', async ({ page }) => {
  await signIn(page, 'lerato-m');
  await page.goto('/');
  const evidence = content(page).locator('section[aria-label="Customer evidence"]');
  await expect(evidence).toBeVisible();
  await expect(evidence).toContainText('Notes not linked yet');
  await axe(page, 'For you with customer evidence');
});

test('Infrastructure: Thabo asks Ines Tau for a new draft of INF-031', async ({ page }) => {
  await signIn(page, 'thabo-n');
  await page.goto('/infrastructure/designs/INF-031');
  await content(page).getByRole('button', { name: /^Ask Ines for a new draft/ }).click();
  await expect(content(page).getByRole('status').first()).toContainText('Ines Tau drafted INF-031 v3');
  await expect(content(page).locator('.inf-meta')).toContainText('INF-031 · v3');
  await axe(page, 'a design after Ines\'s draft');
});
