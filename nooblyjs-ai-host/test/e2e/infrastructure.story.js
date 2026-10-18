// Roadmap Phase 9a in a real browser: NooblyJS Infrastructure (nooblyjs-ai-infrastructure) hosted at /infrastructure. Stevie
// (Owner) and Priya (Contributor) work through the seven steps of the test script, and every Infrastructure screen is
// scanned with axe (WCAG 2.2 AA) and checked at phone width. The provisioner is the mock (about 3 seconds a run).
// test/infrastructure.test.js runs the same steps through the API, with the hosted-app checklist.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const API = '/infrastructure/api/v1';
const content = (page) => page.locator('#noobly-content');

async function signIn(browser, personId) {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.locator(`button[name="personId"][value="${personId}"]`).click();
  await expect(content(page).locator('h1')).toBeVisible();
  return page;
}
async function expectNoAxeViolations(page, label) {
  const result = await new AxeBuilder({ page }).include('#noobly-content').withTags(AA).analyze();
  const summary = result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')})`);
  expect(summary, `axe on ${label}`).toEqual([]);
}
async function expectFitsPhone(page, label) {
  const size = page.viewportSize();
  await page.setViewportSize({ width: 375, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label} scrolls sideways at 375px`).toBeLessThanOrEqual(1);
  await page.setViewportSize(size);
}
const api = (page, path, { method = 'GET', body } = {}) => page.evaluate(async ({ path, method, body }) => {
  const token = document.cookie.split('; ').find((c) => c.startsWith('noobly.csrf='))?.split('=')[1];
  const res = await fetch(path, { method, headers: { 'content-type': 'application/json', ...(token ? { 'x-csrf-token': decodeURIComponent(token) } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}, { path, method, body });

test.describe.configure({ mode: 'serial' });

let stevie;
let priya;
test.beforeAll(async ({ browser }) => {
  stevie = await signIn(browser, 'stevie');
  priya = await signIn(browser, 'priya-s');
});
test.afterAll(async () => {
  for (const page of [stevie, priya]) await page?.context().close();
});

test('step 1: Infra is on the rail between Factory and Teammates, with "1 drift detected"; opening it does not reload the page', async () => {
  const rail = await stevie.locator('#noobly-rail [data-app]').evaluateAll((els) => els.map((el) => el.dataset.app));
  expect(rail.indexOf('infrastructure')).toBe(rail.indexOf('factory') + 1);
  expect(rail.indexOf('teammates')).toBe(rail.indexOf('infrastructure') + 1);
  await stevie.evaluate(() => { window.__nooblyNoReload = 'still here'; });
  await stevie.locator('#noobly-rail [data-app="infrastructure"]').click();
  await expect(content(stevie).locator('h1')).toHaveText('Environments');
  await expect(stevie.locator('#noobly-sidebar')).toContainText('1 drift detected');
  expect(await stevie.evaluate(() => window.__nooblyNoReload)).toBe('still here');
  await expectNoAxeViolations(stevie, 'Environments');
  await expectFitsPhone(stevie, 'Environments');
  // A deep link lands on the same screen after a refresh.
  await stevie.goto('/infrastructure/designs/INF-031');
  await stevie.reload();
  await expect(content(stevie)).toContainText('INF-031');
  await expectNoAxeViolations(stevie, 'Design INF-031');
  await expectFitsPhone(stevie, 'Design INF-031');
});

test('step 2: Home · Approvals shows INF-031 for Test; Priya is refused; Stevie approves it there and the run starts', async () => {
  await stevie.goto('/home/approvals');
  const row = content(stevie).getByRole('link', { name: /INF-031 v2 · Approve & provision Test/ });
  await expect(row).toBeVisible();
  const id = await row.getAttribute('data-approval');
  const refused = await api(priya, `/workflows/api/v1/approvals/${id}/decision`, { method: 'POST', body: { decision: 'approve' } });
  expect(refused.status).toBe(403);
  await row.click();
  await expect(content(stevie).getByRole('link', { name: 'Open INF-031 v2' })).toHaveAttribute('href', '/infrastructure/designs/INF-031?kind=test');
  await expectNoAxeViolations(stevie, 'Approvals with an infrastructure design');
  await content(stevie).getByRole('button', { name: 'Approve & provision Test' }).click();
  await expect(content(stevie)).toContainText('Approved for Test. Provisioning test-slots');
  await stevie.goto('/infrastructure/designs/INF-031');
  await expect(content(stevie)).toContainText('Approved · v2');
});

test('step 3: Provisioning runs move with no refresh; the run page shows the plan, who approved and its log', async () => {
  await stevie.goto('/infrastructure/runs');
  await stevie.evaluate(() => { window.__nooblyNoReload = 'still here'; });
  const row = content(stevie).locator('tr', { hasText: 'test-slots' }).first();
  await expect(row).toContainText('Approved by Stevie');
  // Its status reaches Provisioned by itself: the page follows the event stream.
  await expect(row).toContainText('Provisioned', { timeout: 30_000 });
  expect(await stevie.evaluate(() => window.__nooblyNoReload)).toBe('still here');
  await expectNoAxeViolations(stevie, 'Provisioning runs');
  await expectFitsPhone(stevie, 'Provisioning runs');
  await row.getByRole('link', { name: /Plan and log/ }).click();
  await expect(content(stevie).locator('h1')).toHaveText('Run on test-slots');
  const log = content(stevie).getByRole('list', { name: 'Run log' });
  await expect(log).toContainText('Approved by Stevie');
  await expect(log).toContainText('Provisioned test-slots from INF-031 v2');
  await expect(content(stevie)).toContainText('to add');
  await expectNoAxeViolations(stevie, 'Run detail');
  await expectFitsPhone(stevie, 'Run detail');
});

test('step 4: the Cloud budget lowered below this month\'s cloud spend refuses a new environment with the reason; Activity shows budget.reached', async () => {
  await stevie.goto('/platform/settings');
  await content(stevie).getByRole('tab', { name: 'Budgets' }).click();
  const cloud = content(stevie).locator('.budget').filter({ hasText: 'Cloud (Infrastructure)' }).getByLabel('Monthly ($)');
  await cloud.fill('100');
  await cloud.press('Tab');
  await content(stevie).getByRole('button', { name: 'Save changes' }).click();
  await expect(content(stevie).getByRole('status').first()).toContainText('budgets saved');

  await stevie.goto('/infrastructure/environments');
  await content(stevie).getByRole('button', { name: 'New environment' }).click();
  await content(stevie).getByLabel('Kind').selectOption('dev');
  await content(stevie).getByLabel('Name').fill('dev-two');
  await content(stevie).getByRole('button', { name: 'Create and provision' }).click();
  await expect(content(stevie).getByRole('status')).toContainText('New provisioning is paused: Cloud (Infrastructure) has reached its $100 budget');
  await stevie.goto('/home/activity');
  await expect(content(stevie)).toContainText('Cloud (Infrastructure) reached its $100 budget');

  await stevie.goto('/platform/settings');
  await content(stevie).getByRole('tab', { name: 'Budgets' }).click();
  const again = content(stevie).locator('.budget').filter({ hasText: 'Cloud (Infrastructure)' }).getByLabel('Monthly ($)');
  await again.fill('6000');
  await again.press('Tab');
  await content(stevie).getByRole('button', { name: 'Save changes' }).click();
  await expect(content(stevie).getByRole('status').first()).toContainText('budgets saved');
});

test('step 5: six hours on the dev clock and the drift sweep has run; Restore from design on dev-slots starts a run', async () => {
  const moved = await api(stevie, '/api/v1/dev/clock', { method: 'POST', body: { hours: 6 } });
  expect(moved.status).toBe(200);
  await stevie.goto('/home/activity');
  await expect(content(stevie)).toContainText(/checked \d+ environments for drift/, { timeout: 20_000 });
  await api(stevie, '/api/v1/dev/clock', { method: 'POST', body: { reset: true } });

  await stevie.goto('/infrastructure/environments/dev-slots');
  await expect(content(stevie).getByRole('region', { name: 'Needs attention' })).toContainText('Redis');
  await expectNoAxeViolations(stevie, 'Environment with drift');
  await expectFitsPhone(stevie, 'Environment with drift');
  await content(stevie).getByRole('button', { name: 'Restore from design' }).click();
  await expect(content(stevie).getByRole('status')).toContainText('Restoring from the design. The run has started.');
  // The drift goes when the run ends, with no refresh.
  await expect(content(stevie).getByRole('region', { name: 'Needs attention' })).toHaveCount(0, { timeout: 30_000 });
});

test('step 6: a queued run is cancelled and pr-485 destroyed; both are audited, and pr-485 leaves Platform · Environments', async () => {
  const first = await api(priya, `${API}/environments`, { method: 'POST', body: { name: 'dev-three', kind: 'dev', designId: 'INF-031' } });
  const second = await api(priya, `${API}/environments`, { method: 'POST', body: { name: 'dev-four', kind: 'dev', designId: 'INF-031' } });
  expect([first.status, second.status]).toEqual([201, 201]);
  await priya.goto(`/infrastructure/runs/${second.body.run.id}`);
  await content(priya).getByRole('button', { name: 'Cancel run' }).click();
  await expect(content(priya).getByRole('status')).toContainText(/cancelled|Asked to stop/);
  await expect(content(priya)).toContainText('Cancelled by Priya S.', { timeout: 20_000 });

  await priya.goto('/infrastructure/environments/pr-485');
  await content(priya).getByRole('button', { name: 'Destroy', exact: true }).click();
  const form = content(priya).getByRole('form', { name: 'Destroy pr-485' });
  await expectNoAxeViolations(priya, 'Environment, asking to destroy');
  await form.getByLabel('Why? (kept in the audit log)').fill('PR merged');
  await form.getByRole('button', { name: 'Destroy pr-485' }).click();
  await expect(content(priya).locator('h1')).toHaveText('Environments');
  await expect(content(priya)).not.toContainText('pr-485');

  const audit = await api(stevie, '/api/v1/platform/audit?actor=priya-s');
  const actions = audit.body.records.map((r) => r.action);
  expect(actions).toContain(`POST ${API}/runs/${second.body.run.id}/cancel`);
  expect(actions).toContain(`POST ${API}/environments/pr-485/destroy`);
});

test('step 7: Platform · Environments lists Infrastructure\'s environments, each linking to it', async () => {
  await stevie.goto('/platform/environments');
  await expect(content(stevie)).toContainText('Infrastructure owns environments and previews: this is its list.');
  await expect(content(stevie)).not.toContainText('pr-485');
  await expectNoAxeViolations(stevie, 'Platform · Environments from Infrastructure');
  await content(stevie).getByRole('link', { name: 'staging', exact: true }).click();
  await expect(content(stevie).locator('h1')).toHaveText('staging');
  await expect(stevie.locator('#noobly-rail [data-app="infrastructure"]')).toHaveAttribute('aria-current', 'page');
});

test('the other Infrastructure screens read well at any width', async () => {
  for (const [path, title] of [['/infrastructure/designs', 'Designs'], ['/infrastructure/testing', 'Testing in environments'], ['/infrastructure/blueprints', 'Blueprints'], ['/infrastructure/cost', 'Cost'], ['/infrastructure/policies', 'Policies']]) {
    await stevie.goto(path);
    await expect(content(stevie).locator('h1')).toHaveText(title);
    await expectNoAxeViolations(stevie, title);
    await expectFitsPhone(stevie, title);
  }
});
