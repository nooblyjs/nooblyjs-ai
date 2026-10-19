// Phase 4 in a real browser: the docked team chat panel (roadmap Phase 4, steps 1–6), with axe and phone width.
// It runs last, on PRD-029's thread: by now the earlier specs have approved PRD-031's spec, which the Product
// Factory then refuses to edit. test/chat.test.js runs the same steps on PRD-031, as the roadmap writes them.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const content = (page) => page.locator('#noobly-content');
const chat = (page) => page.locator('#noobly-chat');

async function signIn(page, personId) {
  await page.goto('/login');
  await page.locator(`button[name="personId"][value="${personId}"]`).click();
  await expect(content(page).locator('h1')).toBeVisible();
}
async function expectNoAxeViolations(page, label) {
  const result = await new AxeBuilder({ page }).withTags(AA).analyze();
  const summary = result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')})`);
  expect(summary, `axe on ${label}`).toEqual([]);
}

test('steps 1 to 3: Lerato asks @Ada for a rollout plan; Thabo sees it live; Apply to spec adds a system line and the spec shows the plan', async ({ browser }) => {
  const lerato = await (await browser.newContext()).newPage();
  const thabo = await (await browser.newContext()).newPage();
  await signIn(lerato, 'lerato-m');
  await signIn(thabo, 'thabo-n');
  await thabo.goto('/home/lifecycle/PRD-029');
  await expect(chat(thabo).getByRole('heading', { name: 'Team chat' })).toBeVisible();
  await expect(chat(thabo)).toContainText('No messages yet');

  await lerato.goto('/factory/product/specs/PRD-029');
  await expect(chat(lerato).getByRole('heading', { name: 'Team chat' })).toBeVisible();
  await expect(chat(lerato)).toContainText('PRD-029 · Checkout accessibility');
  await expectNoAxeViolations(lerato, 'Spec with an empty thread');
  const box = chat(lerato).getByRole('textbox', { name: /Message PRD-029/ });
  await box.fill('@Ada draft a rollout plan');
  await box.press('Enter');
  await expect(chat(lerato).locator('.chat-msg--mine .chat-mention')).toHaveText('@Ada');
  await expect(chat(lerato).getByRole('status')).toContainText('Ada Quill is working…');
  const reply = chat(lerato).locator('.chat-msg--agent').last();
  await expect(reply).toContainText("Here's a rollout plan for PRD-029");
  await expect(reply.locator('.chat-msg__tag')).toHaveText('Agent');
  await expect(reply.getByRole('region', { name: 'Plan: Rollout plan' }).locator('li')).toHaveCount(4);
  await expect(reply.getByRole('list', { name: 'Sources' }).locator('li')).toHaveCount(3);
  await expect(reply).toContainText('$0.42 for this answer');
  await expect(chat(lerato).getByRole('status')).toHaveText('');
  await expect(box).toHaveValue('');
  await expectNoAxeViolations(lerato, 'Spec with a plan card');

  // Step 2: Thabo, on the item's page in Lifecycle, has the same thread, live.
  await expect(chat(thabo).locator('.chat-msg').first()).toContainText('@Ada draft a rollout plan');
  await expect(chat(thabo).locator('.chat-msg--agent')).toContainText("Here's a rollout plan for PRD-029");

  // Step 3: Apply to spec. A system line says the new version, and the spec page shows the plan without a reload.
  await lerato.evaluate(() => { window.__nooblyNoReload = 'still here'; });
  await reply.getByRole('button', { name: 'Apply to spec: Rollout plan' }).click();
  await expect(chat(lerato).locator('.chat-line').last()).toHaveText(/Lerato M\. applied the rollout plan to the spec · spec v3/);
  await expect(reply.getByRole('region', { name: 'Plan: Rollout plan' })).toContainText('Applied by Lerato M. · spec v3');
  await expect(reply.getByRole('button', { name: /Apply to spec/ })).toHaveCount(0);
  await expect(content(lerato)).toContainText('Roll out region by region once the pilot meets its targets.');
  expect(await lerato.evaluate(() => window.__nooblyNoReload)).toBe('still here');
  await expect(chat(thabo).locator('.chat-line').last()).toContainText('spec v3');
  await lerato.context().close();
  await thabo.context().close();
});

test('the panel stays open, with what is typed, when the next page is about the same item, and goes away when it isn\'t', async ({ page }) => {
  await signIn(page, 'lerato-m');
  await page.goto('/home/lifecycle/PRD-029');
  const box = chat(page).getByRole('textbox', { name: /Message PRD-029/ });
  await box.fill('half a thought');
  await content(page).getByRole('link', { name: 'Open the spec' }).click();
  await expect(page).toHaveURL(/\/product\/specs\/PRD-029/);
  await expect(content(page).locator('h1')).toBeVisible();
  await expect(box).toHaveValue('half a thought');
  await page.locator('#noobly-rail [data-app="home"]').click();
  await expect(content(page).locator('h1')).toBeVisible();
  await expect(chat(page)).toBeHidden();
});

test('steps 4 and 5: Rhea answers with a comparison card and asks for access; Priya can\'t answer the card, Stevie can', async ({ browser }) => {
  const lerato = await (await browser.newContext()).newPage();
  await signIn(lerato, 'lerato-m');
  await lerato.goto('/factory/product/architecture/PRD-029');
  const box = chat(lerato).getByRole('textbox', { name: /Message PRD-029/ });
  await box.fill('@Rhea can we hit 300 ms without Redis?');
  await chat(lerato).getByRole('button', { name: 'Send' }).click();
  await expect(chat(lerato).getByRole('region', { name: 'Comparison: Redis cache vs read replica' }).locator('tbody tr')).toHaveCount(4);
  const ask = chat(lerato).getByRole('region', { name: 'Approval needed: Read access to delivery-planner' });
  await expect(ask).toContainText('Only someone with the "change-repo-access" permission can answer this.');
  await expect(ask.getByRole('button')).toHaveCount(0);
  await expectNoAxeViolations(lerato, 'Architecture with comparison and approval cards');
  await lerato.context().close();

  const priya = await (await browser.newContext()).newPage();
  await signIn(priya, 'priya-s');
  await priya.goto('/home/lifecycle/PRD-029');
  const hers = chat(priya).getByRole('region', { name: 'Approval needed: Read access to delivery-planner' });
  await expect(hers).toBeVisible();
  await expect(hers.getByRole('button')).toHaveCount(0);
  await priya.context().close();

  const stevie = await (await browser.newContext()).newPage();
  await signIn(stevie, 'stevie');
  await stevie.goto('/home/lifecycle/PRD-029');
  const his = chat(stevie).getByRole('region', { name: 'Approval needed: Read access to delivery-planner' });
  await his.getByRole('button', { name: /^Approve/ }).click();
  await expect(his).toContainText('Approved by Stevie');
  await expect(his.getByRole('button')).toHaveCount(0);
  await expect(chat(stevie).locator('.chat-line').last()).toContainText("Stevie approved Rhea Voss's request: read access to delivery-planner.");
  await stevie.goto('/home/activity');
  await expect(content(stevie).getByRole('region', { name: 'Timeline' })).toContainText("You approved Rhea Voss's request for read access to delivery-planner");
  await stevie.context().close();
});

test('step 6 and phone width: Summarise thread posts a summary; the panel fits a phone and its controls are 44px', async ({ page }) => {
  await signIn(page, 'lerato-m');
  await page.goto('/home/lifecycle/PRD-029');
  await chat(page).getByRole('button', { name: 'Summarise thread' }).click();
  const summary = chat(page).locator('.chat-line').last();
  await expect(summary).toContainText('Summary, asked for by Lerato M.');
  await expect(summary).toContainText('What changed: Lerato M. applied the rollout plan to the spec · spec v3');
  await chat(page).getByRole('button', { name: 'Find related ADRs' }).click();
  await expect(chat(page).locator('.chat-line').last()).toContainText(/decision|No decisions/);
  await expectNoAxeViolations(page, 'Item page with a full thread');

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/home/lifecycle/PRD-029');
  await expect(chat(page).getByRole('heading', { name: 'Team chat' })).toBeVisible();
  await expect(chat(page).locator('.chat-msg').first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'the panel scrolls sideways').toBeLessThanOrEqual(0);
  const small = await page.locator('#noobly-chat button, #noobly-chat textarea').evaluateAll((els) => els
    .filter((e) => e.offsetParent !== null).map((e) => ({ text: (e.textContent || e.name).trim().slice(0, 20), h: e.getBoundingClientRect().height })).filter((r) => r.h < 44));
  expect(small, 'chat controls under 44px').toEqual([]);
});

test('a Viewer can read the thread but has no composer, and the API refuses a post', async ({ page }) => {
  await signIn(page, 'naledi-k');
  await page.goto('/home/lifecycle/PRD-029');
  await expect(chat(page).locator('.chat-msg').first()).toBeVisible();
  await expect(chat(page)).toContainText('Posting needs the "draft" permission.');
  await expect(chat(page).getByRole('textbox')).toHaveCount(0);
  const status = await page.evaluate(async () => {
    const token = decodeURIComponent(/noobly\.csrf=([^;]+)/.exec(document.cookie)[1]);
    const res = await fetch('/api/v1/chat/threads/thr_PRD-029/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': token }, body: JSON.stringify({ text: 'hello' }) });
    return res.status;
  });
  expect(status).toBe(403);
});
