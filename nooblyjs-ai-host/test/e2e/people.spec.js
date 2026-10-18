// Phase 3 in a real browser: onboarding, the For you homes and Teams & roles (roadmap Phase 3, steps 1–8), with
// axe (WCAG 2.2 AA) and phone width. The tests run in order on one data folder, after home.spec.js.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const content = (page) => page.locator('#noobly-content');

async function pick(page, personId) {
  await page.goto('/login');
  await page.locator(`button[name="personId"][value="${personId}"]`).click();
}
async function signIn(page, personId) {
  await pick(page, personId);
  await expect(content(page).locator('h1')).toBeVisible();
}
async function expectNoAxeViolations(page, label) {
  const result = await new AxeBuilder({ page }).withTags(AA).analyze();
  const summary = result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')})`);
  expect(summary, `axe on ${label}`).toEqual([]);
}
const noSidewaysScroll = async (page, label) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label} scrolls sideways`).toBeLessThanOrEqual(0);
};

test('steps 1 and 2: Naledi goes straight to onboarding, Product manager is pre-selected, and she finishes on her home', async ({ page }) => {
  await pick(page, 'naledi-k');
  await expect(page).toHaveURL(/\/onboarding/);
  const main = page.locator('#onboarding');
  await expect(main.locator('h1')).toHaveText('Welcome, Naledi. What do you do?');
  await expect(main).toContainText('We picked one from your profile\'s job title ("Product Manager, Digital").');
  await expect(main.getByRole('radio', { name: /Product manager/ })).toBeChecked();
  await expect(main.getByRole('radio')).toHaveCount(6);
  await expect(page.locator('#onboarding-steps [aria-current="step"]')).toContainText('Your role');
  await expectNoAxeViolations(page, 'onboarding step 1');

  await main.getByRole('button', { name: 'Continue' }).click();
  await expect(main.locator('h1')).toHaveText("Here's what you'll do in NooblyJS");
  await expect(main.locator('h1')).toBeFocused();
  await expect(main).toContainText('Agents research and draft; you shape the problem and approve what moves on.');
  await expect(main).toContainText('Shape ideas from signals');
  await expect(main).toContainText('Ada Quill · research and spec drafting');
  await expect(main).toContainText('Specs waiting on you');
  await expectNoAxeViolations(page, 'onboarding step 2');

  await main.getByRole('button', { name: 'Continue' }).click();
  await expect(main.locator('h1')).toHaveText('Your teams and tools');
  await main.getByRole('checkbox', { name: /Delivery squad/ }).check();
  await expect(main.getByRole('checkbox', { name: 'Send approvals to me in Teams' })).toBeChecked();
  await expect(main).toContainText('Jira Cloud');
  await expectNoAxeViolations(page, 'onboarding step 3');
  // Back keeps what was chosen, and the browser's Back button works too.
  await main.getByRole('button', { name: 'Back' }).click();
  await expect(main.locator('h1')).toHaveText("Here's what you'll do in NooblyJS");
  await page.goBack();
  await expect(main.locator('h1')).toHaveText('Your teams and tools');
  await expect(main.getByRole('checkbox', { name: /Delivery squad/ })).toBeChecked();

  await main.getByRole('button', { name: 'Continue' }).click();
  await expect(main.locator('h1')).toHaveText("You're set");
  await expect(main).toContainText('Your home is tuned for a product manager on the Delivery squad.');
  await expect(main).toContainText('Review PRD-031 · Same-day delivery slots');
  await expectNoAxeViolations(page, 'onboarding step 4');
  await page.setViewportSize({ width: 375, height: 812 });
  await noSidewaysScroll(page, 'onboarding at 375px');
  await page.setViewportSize({ width: 1280, height: 900 });

  await main.getByRole('button', { name: 'Open my home' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(content(page).locator('h1')).toHaveText(/^Good (morning|afternoon|evening), Naledi$/);
});

test('step 3: the PM home filters to her team, Show everything widens the counts, and the sidebar says Getting started', async ({ page }) => {
  await signIn(page, 'naledi-k');
  await expect(content(page).locator('.eyebrow')).toHaveText('For you · Product manager · Delivery squad');
  await expect(content(page).locator('.showing')).toContainText('My items');
  await expect(content(page).locator('.showing')).toContainText('Delivery squad');
  const items = content(page).locator('[data-tile="items"] .tile__value');
  const mine = Number(await items.textContent());
  await expect(content(page).locator('[data-tile="signals"] .tile__value')).not.toHaveText('—');
  await expect(content(page).getByRole('region', { name: 'Top signals' })).toContainText(/slot availability/i);
  await expect(content(page).getByRole('region', { name: 'Your first week' }).locator('.first-week__task--done')).toHaveCount(1);
  await expect(page.locator('#noobly-sidebar .status-card')).toContainText('Getting started');
  await expect(page.locator('#noobly-sidebar .status-card')).toContainText('1 of 4');
  await expect(page.locator('#noobly-sidebar .status-card')).toContainText('Next: review your first spec');
  await expectNoAxeViolations(page, 'For you · PM');

  await content(page).getByRole('link', { name: 'Show everything' }).click();
  await expect(content(page).locator('.showing')).toContainText('Everything');
  await expect(async () => expect(Number(await items.textContent())).toBeGreaterThan(mine)).toPass();
  await page.setViewportSize({ width: 375, height: 812 });
  await noSidewaysScroll(page, 'For you · PM at 375px');
});

test('step 5: Lerato\'s home leads with what waits on her; Nudge works once; her first week is at 2 of 4', async ({ page }) => {
  await signIn(page, 'lerato-m');
  await expect(content(page).locator('h1')).toHaveText(/, Lerato$/);
  const waiting = content(page).getByRole('region', { name: 'Waiting on you' });
  await expect(waiting).toContainText('Checkout accessibility — PRD-029');
  await expect(waiting).toContainText('Mobile promo code fix — PRD-032');
  await expect(content(page).getByRole('region', { name: 'Your items' }).locator('tbody tr').first()).toBeVisible();
  await expect(content(page).getByRole('region', { name: 'Your agent' })).toContainText('Ada Quill is working for you');
  const week = content(page).getByRole('region', { name: 'Your first week' });
  await expect(week.locator('.first-week__task--done')).toHaveCount(2);
  await expect(week).toContainText('2 of 4');
  await expect(page.locator('#noobly-sidebar .status-card')).toContainText('2 of 4');
  const nudge = waiting.getByRole('button', { name: /^Nudge about Store pickup lockers/ });
  if (await nudge.count()) {
    await nudge.click();
    await expect(content(page).locator('.flash')).toContainText('Nudged');
  }
  await week.getByRole('button', { name: 'Hide' }).click();
  await expect(content(page).getByRole('region', { name: 'Your first week' })).toHaveCount(0);
  await expect(page.locator('#noobly-sidebar .status-card')).toContainText('Agents working now');
});

test('step 6: Thabo\'s Architect home shows the decisions with Accept and Discuss; accepting one ticks his first week', async ({ page }) => {
  await signIn(page, 'thabo-n');
  await expect(content(page).locator('.eyebrow')).toHaveText('For you · Architect · Delivery squad');
  const decisions = content(page).getByRole('region', { name: 'Decisions' });
  const open = decisions.locator('.decision');
  const count = await open.count();
  expect(count).toBeGreaterThanOrEqual(1);
  await expect(open.first().getByRole('button', { name: /^Accept ADR-/ })).toBeVisible();
  await expect(open.first().getByRole('link', { name: /^Discuss ADR-/ })).toBeVisible();
  await expect(content(page).getByRole('region', { name: 'Arriving in Architecture' })).toContainText('Store pickup lockers');
  await expect(content(page).getByRole('region', { name: 'Standards broken on PRs' })).toContainText('Arrives in Phase 7');
  await expect(content(page).getByRole('region', { name: 'Models to review' })).toContainText('Arrives in Phase 8');
  await expectNoAxeViolations(page, 'For you · Architect');
  await page.setViewportSize({ width: 375, height: 812 });
  await noSidewaysScroll(page, 'For you · Architect at 375px');
  await page.setViewportSize({ width: 1280, height: 900 });

  const week = content(page).getByRole('region', { name: 'Your first week' });
  const done = await week.locator('.first-week__task--done').count();
  const adr014 = decisions.getByRole('button', { name: 'Accept ADR-014' });
  if (await adr014.count()) {
    await adr014.click();
    await expect(content(page).locator('.flash')).toContainText('Approved');
    // The event ticks the task; the page hears it and redraws.
    await expect(week.locator('.first-week__task--done')).toHaveCount(done + 1);
    await expect(week.locator('.first-week__task--done').last()).toContainText('Decide on ADR-014');
    await expect(page.locator('#noobly-sidebar .status-card')).toContainText(`${done + 1} of 4`);
  }
});

test('steps 7 and 8: Priya\'s Developer home; after Change role to Architect the home changes but she still can\'t accept', async ({ page }) => {
  await signIn(page, 'priya-s');
  await expect(content(page).locator('.eyebrow')).toHaveText('For you · Developer · Checkout squad');
  const prs = content(page).getByRole('region', { name: 'Pull requests to review' });
  await expect(prs).toContainText('web-storefront #481');
  await expect(content(page).getByRole('region', { name: 'A run is asking you' })).toContainText('Software Factory is not running here'); // the specs run with the Factory off; software-factory.story.js has it on
  await expect(content(page).getByRole('region', { name: 'Your teammate' })).toContainText('Juno never merges to main.');
  await expectNoAxeViolations(page, 'For you · Developer');
  await page.setViewportSize({ width: 375, height: 812 });
  await noSidewaysScroll(page, 'For you · Developer at 375px');
  await page.setViewportSize({ width: 1280, height: 900 });

  await content(page).getByRole('link', { name: 'Change role' }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  const main = page.locator('#onboarding');
  await expect(main.getByRole('radio', { name: /Developer/ })).toBeChecked();
  await main.getByText('Architect', { exact: true }).click();
  await expect(main.getByRole('radio', { name: /Architect/ })).toBeChecked();
  await page.locator('#onboarding-steps').getByRole('button', { name: /Your home/ }).click();
  await expect(main).toContainText('Your home is tuned for an architect');
  await main.getByRole('button', { name: 'Open my home' }).click();
  await expect(content(page).locator('.eyebrow')).toHaveText('For you · Architect · Checkout squad');
  await expect(page.locator('#noobly-sidebar .person__role')).toContainText('Architect · Contributor');

  await content(page).getByRole('link', { name: 'Show everything' }).click();
  const decisions = content(page).getByRole('region', { name: 'Decisions' });
  // Whatever decisions are still open (earlier tests may have settled them all), none offers her Accept.
  await expect(decisions.locator('h2')).toHaveText('Decisions awaiting sign-off');
  await expect(decisions.getByRole('button', { name: /^Accept/ })).toHaveCount(0);
  const status = await page.evaluate(async () => {
    const token = decodeURIComponent(/noobly\.csrf=([^;]+)/.exec(document.cookie)[1]);
    const res = await fetch('/workflows/api/v1/approvals/apr_adr015/decision', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': token }, body: JSON.stringify({ decision: 'approve' }) });
    return res.status;
  });
  expect([403, 409]).toContain(status); // 403 for her role; 409 only if an earlier test already withdrew it
});

test('Teams & roles: teams, the matrix and members; an Owner invites a person, who skips onboarding and is offered it again (step 4)', async ({ page }) => {
  await signIn(page, 'stevie');
  await expect(content(page)).toContainText("A For you page for the platform engineer role isn't designed yet");
  await page.goto('/home/teams');
  await expect(content(page).locator('h1')).toHaveText('Teams & roles');
  await expect(content(page).locator('.team')).toHaveCount(3);
  await expect(content(page).getByRole('region', { name: 'Roles and permissions' }).first().locator('tbody tr')).toHaveCount(7);
  await expect(content(page).getByRole('region', { name: 'Members' }).first()).toContainText('Ada Quill');
  await expectNoAxeViolations(page, 'Teams & roles');
  await page.setViewportSize({ width: 375, height: 812 });
  await noSidewaysScroll(page, 'Teams & roles at 375px');
  await page.setViewportSize({ width: 1280, height: 900 });

  await content(page).getByRole('button', { name: 'Invite a person' }).click();
  const form = content(page).locator('[data-form="invite"]');
  await form.getByLabel('Name').fill('Zanele K.');
  await form.getByLabel('Work email').fill('zanele-k@noobly.local');
  await form.getByLabel('Job title').fill('Product Designer');
  await form.getByLabel('Team').selectOption('checkout-squad');
  await expectNoAxeViolations(page, 'Teams & roles · invite');
  await form.getByRole('button', { name: 'Send invite' }).click();
  await expect(content(page).locator('.flash')).toContainText('Zanele K. was invited as Viewer.');
  await expect(content(page).getByRole('region', { name: 'Members' }).first()).toContainText('Zanele K.');

  // Step 4: she signs in, lands on onboarding with Designer suggested, and skips.
  await page.context().clearCookies();
  await pick(page, 'zanele-k');
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.locator('#onboarding').getByRole('radio', { name: /Designer/ })).toBeChecked();
  await page.locator('#onboarding').getByRole('button', { name: 'Skip for now' }).click();
  await expect(content(page).locator('h1')).toBeVisible();
  await expect(content(page)).toContainText('Finish setting up NooblyJS');
  await expect(page.locator('#noobly-sidebar .status-card')).toContainText('Next: pick your role and teams');
  await content(page).getByRole('link', { name: 'Pick your role and teams' }).click();
  await expect(page).toHaveURL(/\/onboarding/);
});

test('a Contributor does not see Invite a person, and the API refuses them', async ({ page }) => {
  await signIn(page, 'priya-s');
  await page.goto('/home/teams');
  await expect(content(page).locator('h1')).toHaveText('Teams & roles');
  await expect(content(page).getByRole('button', { name: 'Invite a person' })).toHaveCount(0);
  const status = await page.evaluate(async () => {
    const token = decodeURIComponent(/noobly\.csrf=([^;]+)/.exec(document.cookie)[1]);
    const res = await fetch('/api/v1/home/people', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': token }, body: JSON.stringify({ name: 'X Y', email: 'x@noobly.local', accessRole: 'Owner' }) });
    return res.status;
  });
  expect(status).toBe(403);
});
