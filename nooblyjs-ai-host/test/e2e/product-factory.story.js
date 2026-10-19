// Roadmap Phase 5 in a real browser, on a fresh seed: PRD-031 goes from signal to Send to Software Factory, with
// agents drafting and a person approving each gate. The steps run in order and share the data (one worker, serial).
// Each screen is scanned with axe (WCAG 2.2 AA) where the step lands on it.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const content = (page) => page.locator('#noobly-content');
const said = (page) => content(page).locator('[data-message]');

async function signIn(browser, personId) {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.locator(`button[name="personId"][value="${personId}"]`).click();
  await expect(content(page).locator('h1')).toBeVisible();
  return page;
}
async function expectNoAxeViolations(page, label) {
  const result = await new AxeBuilder({ page }).withTags(AA).analyze();
  const summary = result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')})`);
  expect(summary, `axe on ${label}`).toEqual([]);
}
async function open(page, path) {
  await page.goto(path);
  await expect(content(page).locator('h1')).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

let lerato; // Product manager, Approver
let stevie; // Owner: the reviewer PRD-031's spec is still waiting on
let thabo; // Architect
let newSpec; // the spec drafted in step 2

test.beforeAll(async ({ browser }) => {
  lerato = await signIn(browser, 'lerato-m');
  stevie = await signIn(browser, 'stevie');
  thabo = await signIn(browser, 'thabo-n');
});
test.afterAll(async () => {
  for (const page of [lerato, stevie, thabo]) await page?.context().close();
});

test('step 1: Lerato turns "Substitutions feel random" into an idea and scores it with RICE', async () => {
  await open(lerato, '/factory/product/board');
  await expectNoAxeViolations(lerato, 'the Product board');
  await content(lerato).getByRole('button', { name: 'Make "Substitutions feel random" an idea' }).click();
  await expect(said(lerato)).toContainText('in Ideas. Score it with RICE below.');
  const form = content(lerato).locator('[data-form="rice"]');
  await expect(form.getByLabel(/Reach/)).toBeFocused();
  await form.getByLabel(/Reach/).fill('40');
  await form.getByLabel(/Impact/).selectOption('2');
  await form.getByLabel(/Effort/).fill('2');
  await expect(form.getByRole('status')).toHaveText('RICE 32'); // 40 × 2 × 0.8 ÷ 2
  await expectNoAxeViolations(lerato, 'the RICE form');
  await form.getByRole('button', { name: 'Save the score' }).click();
  await expect(said(lerato)).toContainText('scores RICE 32');
  const ideas = content(lerato).getByRole('region', { name: 'Ideas' });
  await expect(ideas.locator('.kanban__card').filter({ hasText: 'Substitutions feel random' })).toContainText('RICE 32');
  await expect(content(lerato).getByRole('region', { name: 'Signals' })).not.toContainText('Substitutions feel random');
});

test('step 2: Ada drafts a spec for it: Spec drafting with progress, then In review once Lerato sends it', async () => {
  await content(lerato).getByRole('button', { name: 'Draft a spec for "Substitutions feel random"' }).click();
  await lerato.waitForURL(/\/product\/specs\/PRD-\d+$/);
  newSpec = new URL(lerato.url()).pathname.split('/').pop();
  const brief = content(lerato).locator('[data-form="brief"]');
  await brief.locator('textarea').fill('Substitutes should match what the customer usually buys.');
  await brief.getByRole('button').first().click();

  // Someone else's board shows it in Spec drafting, with who is drafting and how far along.
  await open(stevie, '/factory/product/board');
  const drafting = content(stevie).getByRole('region', { name: 'Spec drafting' }).locator('.kanban__card').filter({ hasText: newSpec });
  await expect(drafting).toContainText(/Ada Quill drafting · \d+%/);

  await expect(said(lerato)).toContainText(/Ada Quill drafted the spec \(v1\) · \$/, { timeout: 30_000 });
  await content(lerato).getByRole('button', { name: 'Send for review' }).click();
  await expect(said(lerato)).toContainText(/^Sent for review to .+\. It is In review on the board\.$/);
  await expect(content(lerato).getByRole('button', { name: 'Send for review' })).toHaveCount(0);
  await stevie.reload();
  await expect(content(stevie).getByRole('region', { name: 'In review' })).toContainText(newSpec);
});

test('step 3: PRD-031 is approved once its rollout plan is in; Architecture shows the container view; Edit as code updates it', async () => {
  // Readiness is 6 of 7 on a fresh seed, and an approval is refused until it is 7 of 7: Ada drafts the rollout plan.
  await open(lerato, '/factory/product/specs/PRD-031');
  await expectNoAxeViolations(lerato, 'the Spec page');
  await content(lerato).getByRole('button', { name: /Ask Ada to draft rollout/ }).click();
  await expect(content(lerato).getByText('7 of 7').first()).toBeVisible({ timeout: 30_000 });

  await open(stevie, '/factory/product/specs/PRD-031');
  await expect(content(stevie).locator('.pf-pills')).toContainText('Needs your approval');
  await content(stevie).getByRole('button', { name: 'Approve & send to Architecture' }).click();
  await expect(said(stevie)).toContainText('Your approval of v5 was sent.');
  await expect(content(stevie).locator('.pf-pills')).toContainText('Approved');

  await open(stevie, '/factory/product/architecture/PRD-031');
  await expect(content(stevie).getByRole('heading', { name: /Container view/ })).toBeVisible();
  await expectNoAxeViolations(stevie, 'the Architecture page');
  await content(stevie).getByRole('button', { name: 'Edit as code' }).click();
  const code = content(stevie).locator('textarea[name="code"]');
  await code.fill((await code.inputValue()).replace('Customer app', 'Shopper app'));
  await content(stevie).getByRole('button', { name: 'Save the diagram' }).click();
  await expect(said(stevie)).toContainText(/Saved the container view as v\d+\./);
  await expect(content(stevie).locator('.pf-node__label').filter({ hasText: 'Shopper app' }).first()).toBeVisible();
  await expect(content(stevie).locator('.pf-node__label').filter({ hasText: 'Customer app' })).toHaveCount(0);
});

test("step 4: Thabo accepts ADR-014, and the quality attributes are the item's gate list", async () => {
  await open(thabo, '/home/lifecycle/PRD-031');
  await expect(content(thabo).getByRole('heading', { name: 'Quality gates' })).toBeVisible();
  await expect(content(thabo)).toContainText('Not final: ADR-014 is still proposed.');

  await open(thabo, '/factory/product/architecture/PRD-031');
  await content(thabo).getByRole('button', { name: /^Accept/ }).first().click();
  await expect(said(thabo)).toContainText('ADR-014 is accepted.');

  await open(thabo, '/home/lifecycle/PRD-031');
  await expect(content(thabo)).toContainText('4 gates the Software Factory checks on every PR for this item.');
  const gates = content(thabo).getByRole('region', { name: 'Quality gates for this item' });
  await expect(gates.locator('tbody tr')).toHaveCount(4);
  await expect(gates).toContainText('p95 < 300 ms');
  await expectNoAxeViolations(thabo, 'the item page with its gates');
});

test('step 5: UX Design and UI Design show their status, and the accessibility checks name the failing one', async () => {
  // The Architect and then an Approver move the item on: each move is a person's decision on the item's page.
  for (const [page, label] of [[thabo, 'Approve & move to UX design'], [stevie, 'Approve & move to UI design']]) {
    await open(page, '/home/lifecycle/PRD-031');
    await content(page).locator('[data-form="advance"]').getByRole('button', { name: label }).click();
    await expect(content(page).locator('.flash')).toContainText('Approved.');
  }
  await open(lerato, '/factory/product/ux/PRD-031');
  await expect(content(lerato).getByRole('tablist', { name: 'UX views' })).toBeVisible();
  await expectNoAxeViolations(lerato, 'the UX Design page');

  await open(lerato, '/factory/product/ui/PRD-031');
  const screens = content(lerato).locator('.card').filter({ has: lerato.getByRole('heading', { name: /^Screens/ }) });
  await expect(screens).toContainText('Approved');
  await expect(screens).toContainText('In review');
  const checks = content(lerato).locator('.card').filter({ has: lerato.getByRole('heading', { name: 'Accessibility' }) });
  await expect(checks).toContainText('3 of 4');
  await expect(checks).toContainText('Timer needs a screen-reader label');
  await expectNoAxeViolations(lerato, 'the UI Design page');
});

test('step 6: Send to Software Factory creates 6 work items with the estimate, and the item moves to Build', async () => {
  const preview = content(lerato).locator('.card').filter({ has: lerato.getByRole('heading', { name: 'Handoff preview' }) });
  await expect(preview).toContainText('6 work items for the Software Factory');
  await expect(preview).toContainText('Estimated $18–$26');
  await content(lerato).getByRole('button', { name: 'Send to Software Factory' }).first().click();
  await content(lerato).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(said(lerato)).toContainText(/Sent 6 work items across \d+ repos to the Software Factory\./);
  await expect(preview).toContainText('Handed off to the Software Factory');

  await open(lerato, '/home/lifecycle/PRD-031');
  await expect(content(lerato).locator('h1 + *, .lead').first()).toContainText('in Build');
  await open(lerato, '/factory/product/handoffs');
  await expect(content(lerato)).toContainText(/UI design → Software Factory · 6 work items/);
  await expectNoAxeViolations(lerato, 'the Handoffs page');
});

test('the wrong roles are refused: a Contributor has no Approve, and a Viewer cannot send for review, add or decide', async ({ browser }) => {
  const priya = await signIn(browser, 'priya-s'); // Contributor: may draft, not approve
  await open(priya, `/factory/product/specs/${newSpec}`);
  await expect(content(priya).getByRole('button', { name: /Approve/ })).toHaveCount(0);
  // Naledi is a Viewer (and new, so the frame sends her to onboarding): the API is what refuses her.
  const naledi = await (await browser.newContext()).newPage();
  await naledi.goto('/login');
  await naledi.locator('button[name="personId"][value="naledi-k"]').click();
  await naledi.waitForURL((url) => url.pathname !== '/login');
  const refused = await naledi.evaluate(async (id) => {
    const csrf = /(?:^|;\s*)noobly\.csrf=([^;]+)/.exec(document.cookie)?.[1] ?? '';
    const post = async (path) => (await fetch(`/factory/product/api/v1/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: '{}' })).status;
    return [await post(`specs/${id}/review`), await post('ideas'), await post('specs/PRD-031/decision')];
  }, newSpec);
  expect(refused).toEqual([403, 403, 403]);
  await priya.context().close();
  await naledi.context().close();
});

test('the board and the RICE form fit a phone: no sideways scroll', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage();
  await page.goto('/login');
  await page.locator('button[name="personId"][value="lerato-m"]').click();
  await expect(content(page).locator('h1')).toBeVisible();
  for (const path of ['/factory/product/board', `/factory/product/specs/${newSpec}`, '/factory/product/architecture/PRD-031', '/factory/product/ui/PRD-031', '/home/lifecycle/PRD-031']) {
    await open(page, path);
    if (path === '/factory/product/board') await content(page).getByRole('button', { name: /^Rescore/ }).first().click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
  }
  await page.context().close();
});
