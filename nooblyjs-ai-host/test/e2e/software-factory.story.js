// Roadmap Phase 7 in a real browser: a handoff approved in NooblyJS becomes Software Factory runs on the demo
// repository; the runs report to the item; a stuck run asks a developer, who answers from her home; and no agent
// merges. The Factory is hosted with its scheduler in the NooblyJS process, and the agents are the seed's scripts
// (no model is called). The runs do real git and a real test gate, so the steps wait for them. Each Factory page
// is scanned with axe (WCAG 2.2 AA). test/software-factory.test.js covers the same steps through the API.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const content = (page) => page.locator('#noobly-content');
const RUNS = 180_000; // a run: clone, scripted agents, the repository's own tests, a PR file

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

let stevie; // Owner: the Design lead's approval is his to give
let priya; // Developer, Contributor

test.beforeAll(async ({ browser }) => {
  stevie = await signIn(browser, 'stevie');
  priya = await signIn(browser, 'priya-s');
});
test.afterAll(async () => {
  for (const page of [stevie, priya]) await page?.context().close();
});

test('before anything runs: Factory Metrics has an empty state, and every Factory page is in the frame and passes axe', async () => {
  // Hosted-app checklist: from Home, the rail opens the Factory without reloading the page; a deep link works.
  await priya.evaluate(() => { window.__nooblyNoReload = 'still here'; });
  await priya.locator('#noobly-rail').getByRole('link', { name: /Factory/ }).last().click();
  await expect(priya).toHaveURL(/\/factory\/line$/);
  await expect(content(priya).locator('h1')).toHaveText('The line');
  expect(await priya.evaluate(() => window.__nooblyNoReload)).toBe('still here');
  await open(priya, '/factory/metrics');
  await priya.reload();
  await expect(content(priya).locator('h1')).toHaveText('Metrics');
  await expect(content(priya).getByRole('heading', { level: 2, name: /^No runs/ })).toBeVisible();
  await expectNoAxeViolations(priya, 'Factory · Metrics (empty)');
  for (const [path, title] of [['/factory/line', 'The line'], ['/factory/runs', 'Runs'], ['/factory/inbox', 'Inbox'], ['/factory/campaigns', 'Campaigns']]) {
    await open(priya, path);
    await expect(content(priya).locator('h1')).toHaveText(title);
    await expect(priya.locator('#noobly-rail')).toBeVisible();
    await expectNoAxeViolations(priya, `Factory · ${title} (empty)`);
  }
  // The page head is the kit's component, not the Factory's own.
  await expect(content(priya).locator('header.page-head h1.page-title')).toHaveCount(1);
});

test('step 1: the Design lead approves the handoff for PRD-028, and two runs are queued on the demo repository', async () => {
  await open(stevie, '/home/approvals?id=apr_slotpickerui');
  const detail = content(stevie).getByRole('region', { name: 'Selected approval' });
  await expect(detail).toContainText('PRD-028');
  await detail.getByRole('button', { name: /^Approve/ }).click();
  await open(priya, '/home/lifecycle/PRD-028');
  const card = content(priya).locator('section.card', { hasText: 'Software Factory' }).first();
  await expect(card).toContainText('SlotChip, HoldTimer', { timeout: 20_000 });
  await expect(card).toContainText('picker, nearby, basket');
  await expect(card).toContainText('2 runs · 4 waiting');
  await expect(card).toContainText('no repository is set up for "slots-api"');
  await expectNoAxeViolations(priya, 'Item · PRD-028 with runs');
});

test('step 2: the runs show on the Line; one ends with a ready PR and its gate result on the item', async () => {
  await open(priya, '/factory/line');
  await expectNoAxeViolations(priya, 'Factory · Line (working)');
  await open(priya, '/home/lifecycle/PRD-028');
  const row = content(priya).locator('li.wait', { hasText: 'SlotChip, HoldTimer' });
  await expect(row).toContainText('PR ready', { timeout: RUNS });
  await expect(row).toContainText('gates: test passed');
  // The run's own page: the story, the checks and the evidence.
  await row.getByRole('link', { name: 'SlotChip, HoldTimer' }).click();
  await expect(priya).toHaveURL(/\/factory\/runs\//);
  await expect(content(priya).locator('h1')).toHaveText('SlotChip, HoldTimer');
  await expectNoAxeViolations(priya, 'Factory · Run');
});

test('step 3: the other run fails its gate and asks; Priya answers from her home, and it ends with a ready PR', async ({ browser }) => {
  await open(priya, '/');
  const ask = content(priya).locator('.run-ask');
  await expect(ask).toContainText('needs a person', { timeout: RUNS });
  await expect(ask).toContainText('PRD-028');
  await expectNoAxeViolations(priya, 'For you · Developer with a question');

  // Naledi is a Viewer (and new, so the frame sends her to onboarding): she can read the question, and the API
  // refuses her answer.
  const naledi = await (await browser.newContext()).newPage();
  await naledi.goto('/login');
  await naledi.locator('button[name="personId"][value="naledi-k"]').click();
  await naledi.waitForURL((url) => url.pathname !== '/login');
  const refused = await naledi.evaluate(async () => {
    const csrf = /(?:^|;s*)noobly.csrf=([^;]+)/.exec(document.cookie)?.[1] ?? '';
    const { entries } = await (await fetch('/factory/api/v1/inbox')).json();
    const res = await fetch(`/factory/api/v1/inbox/${entries[0].id}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ decision: 'answered', answer: 'x' }) });
    return [entries.length, entries[0].kind, res.status];
  });
  expect(refused).toEqual([1, 'escalation', 403]);
  await naledi.context().close();
  await open(priya, '/factory/inbox');
  await expect(content(priya)).toContainText('needs a person');
  // A stuck run's question is the developers': a Contributor may answer it in the Factory inbox as well.
  await expect(content(priya).getByRole('button', { name: 'Send answer' })).toBeVisible();
  await expectNoAxeViolations(priya, 'Factory · Inbox (one waiting)');
  await open(priya, '/');

  // The thread of the item says a run is asking.
  await open(stevie, '/home/lifecycle/PRD-028');
  await expect(stevie.locator('#noobly-chat')).toContainText('A Software Factory run is asking a person');

  await ask.getByRole('textbox').fill('A store exactly at the limit counts: make it inclusive.');
  await ask.getByRole('button', { name: 'Send answer' }).click();
  await expect(content(priya).locator('.run-ask')).toHaveCount(0, { timeout: 20_000 });
  await open(priya, '/home/lifecycle/PRD-028');
  const row = content(priya).locator('li.wait', { hasText: 'picker, nearby, basket' });
  await expect(row).toContainText('PR ready', { timeout: RUNS });
  await expect(row).toContainText('gates: test passed');
});

test('step 4: nothing was merged; Activity shows the runs under Factory, and the item is still in Build', async () => {
  await open(priya, '/home/activity?filter=factory');
  await expect(content(priya)).toContainText('finished run "SlotChip, HoldTimer": delivered');
  await expect(content(priya)).toContainText('finished run "picker, nearby, basket": delivered');
  await open(priya, '/factory/runs');
  await expect(content(priya).locator('tbody tr')).toHaveCount(2);
  await expect(content(priya).locator('tbody')).not.toContainText('Merged');
  await expectNoAxeViolations(priya, 'Factory · Runs (two delivered)');
});

test('step 5: Factory Metrics counts the two runs, their times and their cost; phone width works', async () => {
  await open(priya, '/factory/metrics');
  const runs = content(priya).locator('.stat', { hasText: 'Runs' }).first();
  await expect(runs.locator('.stat__value')).toHaveText('2');
  await expect(content(priya).getByRole('region', { name: 'Stations' })).toContainText('Build');
  await expect(content(priya)).toContainText('Lead time to PR');
  await expectNoAxeViolations(priya, 'Factory · Metrics');
  await priya.setViewportSize({ width: 390, height: 844 });
  await open(priya, '/factory/metrics');
  expect(await priya.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll at 390px').toBe(true);
  await expectNoAxeViolations(priya, 'Factory · Metrics at 390px');
  await priya.setViewportSize({ width: 1280, height: 720 });
});
