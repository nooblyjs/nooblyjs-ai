// Roadmap Phase 9 in a real browser: Platform and governance. Stevie (Owner) and Lerato (Approver) work through the
// six steps of the test script on the Platform screens, each scanned with axe (WCAG 2.2 AA) and checked at phone
// width. No model is configured: agents answer from their scripts, and the model route shows as mock/<model>.
// test/platform.test.js runs the same six steps through the API and the real apps.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const content = (page) => page.locator('#noobly-content');
const chat = (page) => page.locator('#noobly-chat');

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
/** At 375px wide the page scrolls down, never sideways. */
async function expectFitsPhone(page, label) {
  const size = page.viewportSize();
  await page.setViewportSize({ width: 375, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label} scrolls sideways at 375px`).toBeLessThanOrEqual(1);
  await page.setViewportSize(size);
}
/** The API as the page's own session sees it (with the CSRF token for a change). */
const api = (page, path, { method = 'GET', body } = {}) => page.evaluate(async ({ path, method, body }) => {
  const token = document.cookie.split('; ').find((c) => c.startsWith('noobly.csrf='))?.split('=')[1];
  const res = await fetch(path, { method, headers: { 'content-type': 'application/json', ...(token ? { 'x-csrf-token': decodeURIComponent(token) } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}, { path, method, body });

test.describe.configure({ mode: 'serial' });

let stevie;
let lerato;
test.beforeAll(async ({ browser }) => {
  stevie = await signIn(browser, 'stevie');
  lerato = await signIn(browser, 'lerato-m');
});
test.afterAll(async () => {
  for (const page of [stevie, lerato]) await page?.context().close();
});

test('step 1: payments-gateway set to "No agent access"; asking a teammate about it is refused, and the refusal is audited', async () => {
  await stevie.goto('/platform/repositories');
  await expect(content(stevie).locator('h1')).toHaveText('Repositories');
  await expect(content(stevie)).toContainText('7 connected. Agents can only touch what is granted here.');
  await expect(content(stevie).getByRole('button', { name: /Factory enabled/ })).toContainText('4');
  await expectNoAxeViolations(stevie, 'Repositories');
  await expectFitsPhone(stevie, 'Repositories');

  await content(stevie).getByRole('link', { name: 'acme/payments-gateway' }).click();
  await expect(content(stevie).getByRole('heading', { name: 'payments-gateway · repository settings' })).toBeVisible();
  const access = content(stevie).getByLabel('Agent access');
  await access.selectOption('read');
  await expect(content(stevie).getByRole('status')).toContainText('Agent access on acme/payments-gateway is now "Read only".');
  await content(stevie).getByLabel('Agent access').selectOption('none');
  await expect(content(stevie).getByRole('status')).toContainText('is now "No agent access"');
  await expect(content(stevie).getByRole('switch', { name: 'Merge after all gates pass' })).toBeDisabled();
  await expectNoAxeViolations(stevie, 'Repository settings');
  await expectFitsPhone(stevie, 'Repository settings');

  // The repository's own thread: Ada is asked to read it, and Platform refuses before any model or cost.
  const box = chat(stevie).getByRole('textbox', { name: /Message/ });
  await box.fill('@Ada summarise what this repository does');
  await box.press('Enter');
  await expect(chat(stevie).locator('.chat-line, .chat-msg').last()).toContainText('Agents have no access to acme/payments-gateway', { timeout: 15_000 });
  const audit = await api(stevie, '/api/v1/platform/audit?action=agent.work_refused');
  expect(audit.body.records.some((r) => r.record.code === 'repo_no_access' && r.record.repo === 'acme/payments-gateway' && r.actor === 'ada-quill')).toBe(true);
});

test('step 2: the Product Factory budget lowered below this month\'s spend pauses its agents; Activity says so; a new draft says why', async () => {
  await stevie.goto('/platform/settings');
  await content(stevie).getByRole('tab', { name: 'Budgets' }).click();
  await expect(content(stevie)).toContainText('$412 of $1,500');
  await expectNoAxeViolations(stevie, 'Settings · Budgets');
  await expectFitsPhone(stevie, 'Settings · Budgets');
  const product = content(stevie).locator('.budget').filter({ hasText: 'Product Factory' }).getByLabel('Monthly ($)');
  await product.fill('400');
  await product.press('Tab');
  await expect(content(stevie)).toContainText('Unsaved changes: budgets');
  await content(stevie).getByRole('button', { name: 'Save changes' }).click();
  await expect(content(stevie).getByRole('status').first()).toContainText('Product Factory has reached its $400 budget: its agents are paused');

  await stevie.goto('/home/activity');
  await expect(content(stevie)).toContainText('Product Factory reached its $400 budget ($412 spent): its agents are paused');

  const refused = await api(lerato, '/factory/product/api/v1/specs/PRD-031/drafts', { method: 'POST', body: { kind: 'rollout-plan' } });
  expect(refused.status).toBe(402);
  expect(refused.body.error.message).toBe('Agents are paused: Product Factory has reached its $400 budget ($412 spent this month). An Owner can raise it in Platform · Settings · Budgets.');

  // Back to the seed's budget for the steps that follow.
  await stevie.goto('/platform/settings');
  await content(stevie).getByRole('tab', { name: 'Budgets' }).click();
  const again = content(stevie).locator('.budget').filter({ hasText: 'Product Factory' }).getByLabel('Monthly ($)');
  await again.fill('1500');
  await again.press('Tab');
  await content(stevie).getByRole('button', { name: 'Save changes' }).click();
  await expect(content(stevie).getByRole('status').first()).toContainText('budgets saved');
});

test('step 3: turning off "Redact personal data on ingest" needs an Owner and a reason, and is in policy history and the audit log', async () => {
  await lerato.goto('/platform/settings');
  await content(lerato).getByRole('tab', { name: 'Guardrails' }).click();
  await expect(content(lerato).getByRole('switch', { name: 'Redact personal data on ingest' })).toBeDisabled();

  await stevie.goto('/platform/settings');
  await content(stevie).getByRole('tab', { name: 'Guardrails' }).click();
  await expect(content(stevie).getByRole('switch', { name: 'Agents open PRs, people merge' })).toBeDisabled();
  await content(stevie).getByRole('switch', { name: 'Redact personal data on ingest' }).click();
  const form = content(stevie).getByRole('form', { name: 'Turn off "Redact personal data on ingest"?' });
  await expect(form).toBeVisible();
  await expectNoAxeViolations(stevie, 'Settings · Guardrails, asking why');
  await form.getByLabel('Why? (kept in the audit log)').fill('Importing the contacts export for the pilot');
  await form.getByRole('button', { name: 'Turn off' }).click();
  await expect(content(stevie).getByRole('status').first()).toContainText('"Redact personal data on ingest" is off. It is in the policy history.');
  await content(stevie).getByRole('button', { name: 'Policy history' }).click();
  const history = content(stevie).getByRole('region', { name: 'Policy history' });
  await expect(history).toContainText('Importing the contacts export for the pilot');
  await expect(history).toContainText('On → Off');
  await expectFitsPhone(stevie, 'Settings · Guardrails');

  await stevie.goto('/platform/audit');
  await content(stevie).getByLabel('Action').fill('guardrail.changed');
  await content(stevie).getByRole('button', { name: 'Filter' }).click();
  await expect(content(stevie).getByRole('region', { name: 'Audit records' }).locator('tbody tr')).toHaveCount(1);
  await expect(content(stevie).getByRole('region', { name: 'Audit records' })).toContainText('guardrail:redact-on-ingest');
});

test('step 4: the "Specs, architecture, review" route changed to Sonnet; the next drafting call uses it', async () => {
  await stevie.goto('/platform/settings');
  await expectNoAxeViolations(stevie, 'Settings · Models');
  await expectFitsPhone(stevie, 'Settings · Models');
  await content(stevie).getByLabel('Model for Specs, architecture, review').selectOption('claude-sonnet-5-5');
  await content(stevie).getByLabel('Fallback for Specs, architecture, review').selectOption('claude-haiku-4-5');
  await content(stevie).getByRole('button', { name: 'Save changes' }).click();
  await expect(content(stevie).getByRole('status').first()).toContainText('"Specs, architecture, review" now uses Claude Sonnet 5.5 on AWS Bedrock');

  const asked = await api(lerato, '/factory/product/api/v1/specs/PRD-031/drafts', { method: 'POST', body: { kind: 'rollout-plan' } });
  expect(asked.status).toBe(202);
  await expect.poll(async () => {
    const { body } = await api(stevie, '/api/v1/platform/audit?action=agent.spec-drafting');
    return body.records[0]?.record.modelRoute ?? null;
  }, { timeout: 30_000 }).toBe('mock/claude-sonnet-5-5');
});

test('step 5: Stop all containers stops every running workload, and the tiles show 0 running', async () => {
  await lerato.goto('/platform/containers');
  await expect(content(lerato).getByRole('button', { name: 'Stop all containers' })).toHaveCount(0);

  await stevie.goto('/platform/containers');
  const running = content(stevie).locator('.tile').filter({ hasText: 'Running' }).locator('.tile__value');
  await expect(running).not.toHaveText('0');
  await expect(content(stevie)).toContainText('Otis Fern · CRM dedupe');
  await expectNoAxeViolations(stevie, 'Containers');
  await expectFitsPhone(stevie, 'Containers');
  await content(stevie).getByRole('button', { name: 'Stop all containers' }).click();
  const form = content(stevie).getByRole('form', { name: 'Stop all containers?' });
  await form.getByLabel('Why? (kept in the audit log)').fill('Phase 9 drill');
  await form.getByRole('button', { name: 'Stop all containers' }).click();
  await expect(content(stevie).getByRole('status').first()).toContainText('0 running.');
  await expect(running).toHaveText('0');
  await expect(content(stevie).locator('.table-wrap[aria-label="Running now"]')).toContainText('Nothing is running.');
});

test('step 6: the audit log filters by actor, action and date, and matches the records', async () => {
  await lerato.goto('/platform/audit');
  await expectNoAxeViolations(lerato, 'Audit log');
  await expectFitsPhone(lerato, 'Audit log');
  const day = new Date().toISOString().slice(0, 10);
  await content(lerato).getByLabel('Actor').fill('stevie');
  await content(lerato).getByLabel('Action').fill('repo.');
  await content(lerato).getByLabel('From').fill(day);
  await content(lerato).getByRole('button', { name: 'Filter' }).click();
  const rows = content(lerato).getByRole('region', { name: 'Audit records' }).locator('tbody tr');
  const { body } = await api(lerato, `/api/v1/platform/audit?actor=stevie&action=repo.&from=${day}&to=${day}`);
  expect(body.total).toBeGreaterThanOrEqual(2);
  await expect(rows).toHaveCount(body.records.length);
  for (const [i, r] of body.records.entries()) await expect(rows.nth(i)).toContainText(r.action);

  // A Contributor can't read it.
  const priya = await (await lerato.context().browser().newContext()).newPage();
  await priya.goto('/login');
  await priya.locator('button[name="personId"][value="priya-s"]').click();
  await priya.goto('/platform/audit');
  await expect(content(priya)).toContainText('The audit log needs the read-audit permission');
  await priya.context().close();
});

test('the other Platform screens: Environments, Secrets and Members read well at any width', async () => {
  for (const [path, title] of [['/platform/environments', 'Environments'], ['/platform/secrets', 'Secrets'], ['/platform/members', 'Members']]) {
    await stevie.goto(path);
    await expect(content(stevie).locator('h1')).toHaveText(title);
    await expectNoAxeViolations(stevie, title);
    await expectFitsPhone(stevie, title);
  }
  await content(stevie).getByRole('button', { name: 'Change role for Priya S.' }).click();
  await content(stevie).locator('[data-form="role"] select[name="accessRole"]').selectOption('Approver');
  await content(stevie).getByLabel('Why? (kept in the audit log)').fill('Approves the checkout squad\'s specs');
  await content(stevie).getByRole('button', { name: 'Change role', exact: true }).click();
  await expect(content(stevie).getByRole('status').first()).toContainText('Priya S. is now Approver.');
});
