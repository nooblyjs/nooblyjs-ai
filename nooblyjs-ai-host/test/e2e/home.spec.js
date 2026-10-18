// Phase 2 in a real browser: Overview, Lifecycle, Approvals and Activity on the seeded PRD-031 story (roadmap
// Phase 2, steps 1–8), with axe (WCAG 2.2 AA), phone width, and a second browser that sees changes without a
// refresh. The tests run in order on one data folder: the later ones change it.
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
  const result = await new AxeBuilder({ page }).withTags(AA).analyze();
  const summary = result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')})`);
  expect(summary, `axe on ${label}`).toEqual([]);
}

test('step 1: Overview shows 12 in flight, the stage strip and four waiting on Stevie', async ({ page }) => {
  await signIn(page, 'stevie');
  await page.goto('/home/overview');
  await expect(content(page).locator('.lead')).toHaveText('12 items in flight across 2 systems. Four are waiting on you.');
  await expect(content(page).locator('.stage__count')).toHaveText(['3', '4', '2', '0', '1', '1', '1']);
  await expect(content(page).locator('.system')).toHaveCount(5);
  await expect(content(page).locator('.wait')).toHaveCount(4);
  await expect(content(page).locator('.wait').first()).toContainText('Drafted by Ada Quill · readiness 6 of 7 checks');
  await expect(content(page).getByRole('region', { name: 'Recent activity' })).toContainText('Ada Quill clustered 412 support tickets into 5 themes');
  await expect(page.locator('#noobly-sidebar [data-nav="approvals"] .nav__badge')).toContainText('4');
  await expect(page.locator('#noobly-sidebar .status-card')).toContainText('2 agents · 12 items in flight');
  await expectNoAxeViolations(page, 'Overview');
});

test('Lifecycle: the swimlane says who has each item, the filters count, and an item opens with its history', async ({ page }) => {
  await signIn(page, 'stevie');
  await page.goto('/home/lifecycle');
  const rows = content(page).locator('.swimlane tbody tr');
  await expect(rows).toHaveCount(12);
  await expect(rows.filter({ hasText: 'PRD-031' })).toContainText('Your review');
  await expect(rows.filter({ hasText: 'PRD-027' })).toContainText('Rhea drafting');
  await expect(rows.filter({ hasText: 'PRD-025' })).toContainText('Waiting 4 d');
  await expect(rows.filter({ hasText: 'slots-api #482' })).toContainText('Your merge');
  await expect(rows.filter({ hasText: 'IDEA-018' })).toContainText('RICE 42');
  await expect(content(page).locator('.health__stage')).toHaveCount(7);
  await expect(content(page).locator('.health__stage--slowest')).toHaveCount(1);
  await expect(content(page).getByRole('region', { name: 'Where work waits' })).toContainText('Spec approval');
  await expect(content(page).getByRole('region', { name: 'Handoffs this week' })).toContainText('Sent back for changes');
  await expectNoAxeViolations(page, 'Lifecycle');

  await page.getByRole('button', { name: /^Mine/ }).click();
  await expect(page.getByRole('button', { name: /^Mine/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(rows).toHaveCount(3);
  await expect(page).toHaveURL(/filter=mine/);

  await rows.filter({ hasText: 'PRD-031' }).getByRole('link').click();
  await expect(content(page).locator('h1')).toHaveText('Same-day delivery slots');
  await expect(content(page)).toContainText('6 of 7 checks');
  await expect(content(page)).toContainText('Rollout plan missing');
  await expect(page).toHaveTitle('PRD-031 · Same-day delivery slots · Home · NooblyJS');
  await expectNoAxeViolations(page, 'Lifecycle item');
});

test('step 2: Approvals shows the PRD-031 approval with its readiness, reviewers and the rules table', async ({ page }) => {
  await signIn(page, 'stevie');
  await page.goto('/home/approvals');
  await expect(content(page).locator('.lead')).toContainText('Four are waiting on you; the oldest for 26 hours.');
  await expect(page.getByRole('button', { name: 'Waiting on you 4' })).toHaveAttribute('aria-pressed', 'true');
  await expect(content(page).locator('.queue__item')).toHaveCount(4);
  const detail = content(page).getByRole('region', { name: 'Selected approval' });
  await expect(detail.locator('h2')).toHaveText('Same-day delivery slots');
  await expect(detail).toContainText('Requested by Ada Quill');
  await expect(detail).toContainText('6 of 7 checks');
  await expect(detail).toContainText('Rollout plan missing');
  await expect(detail).toContainText('1 of 1 approved');
  await expect(detail).toContainText('Lerato M.');
  await expect(detail).toContainText('$7.40');
  await expect(detail.getByRole('button', { name: 'Approve & send to Architecture' })).toBeVisible();
  await expect(content(page).getByRole('region', { name: 'Approval rules' }).locator('tbody tr')).toHaveCount(7); // with the infrastructure design rule (9a) and a write to Jira or Bitbucket (13)
  await expectNoAxeViolations(page, 'Approvals');

  await content(page).locator('.queue__item', { hasText: 'ADR-014' }).click();
  await expect(detail.locator('h2')).toHaveText('ADR-014 · Cache slot availability in Redis');
  await expect(detail.locator('h2')).toBeFocused();
  await page.getByRole('button', { name: /^Done this week/ }).click();
  await expect(content(page).locator('.queue__item')).toHaveCount(3);
  await expectNoAxeViolations(page, 'Approvals · done');
});

test('Activity: the timeline by day, the filters, Live now and Today so far', async ({ page }) => {
  await signIn(page, 'stevie');
  await page.goto('/home/activity');
  const timeline = content(page).getByRole('region', { name: 'Timeline' });
  await expect(timeline.locator('.timeline__day').first()).toHaveText(/Today|Yesterday/);
  await expect(timeline).toContainText('Run 213 failed the contract-test gate on slots-api and retried');
  await expect(timeline).toContainText('passed on retry');
  await expect(timeline).toContainText('$0.84');
  await expect(content(page).getByRole('region', { name: 'Live now' })).toContainText('2 working');
  await expect(content(page).getByRole('region', { name: 'Today in numbers' })).toContainText('agent actions');
  await expectNoAxeViolations(page, 'Activity');

  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await expect(timeline).not.toContainText('Run 213');
  await expect(timeline).toContainText('Ada Quill');
  await page.getByRole('searchbox', { name: 'Filter activity' }).fill('ADR-014');
  await expect(timeline.locator('.timeline__row')).toHaveCount(1);
});

test('Metrics (Phase 10): the seeded numbers are the mockup story, the charts have their numbers as tables, and the period switches without a reload', async ({ page }) => {
  await signIn(page, 'stevie');
  await page.goto('/home/metrics');
  await expect(content(page).locator('h1')).toHaveText('Metrics');
  await expect(content(page).locator('.lead')).toContainText('who does the work. Last 30 days.');
  const tiles = content(page).getByRole('region', { name: 'Headline metrics' }).locator('.stat');
  await expect(tiles).toHaveCount(5);
  await expect(tiles.nth(0)).toContainText('9.1 d');
  await expect(tiles.nth(0)).toContainText('1.8 d faster than last period');
  await expect(tiles.nth(1)).toContainText('38');
  await expect(tiles.nth(1)).toContainText('from 12 approved specs');
  await expect(tiles.nth(2)).toContainText('71%');
  await expect(tiles.nth(2)).toContainText('27 of 38 passed first time');
  await expect(tiles.nth(3)).toContainText('18%');
  await expect(tiles.nth(4)).toContainText('$6.10');

  const lead = content(page).getByRole('region', { name: 'Lead time by stage' });
  await expect(lead.locator('.leadtime__col')).toHaveCount(6);
  await expect(lead.locator('.leadtime__labels span')).toHaveText([/· 11\.2 d$/, /· 10\.4 d$/, /· 9\.9 d$/, /· 9\.3 d$/, /· 8\.9 d$/, /· 8\.5 d$/]);
  await expect(lead.locator('.leadtime__axis span')).toHaveText(['12 d', '8 d', '4 d', '0']);
  // The same numbers as a table, for people who do not see the columns.
  await expect(lead.locator('table tbody tr')).toHaveCount(6);
  await expect(lead.locator('table tbody tr').last().locator('td')).toHaveText(['2.4', '2.6', '1.6', '1.9', '8.5']);
  await expect(lead).toContainText('Architecture is the largest share every week');
  // The tallest column is the first week's: 11.2 of 12 days of a 240px chart.
  const height = await lead.locator('.leadtime__col').first().evaluate((el) => el.getBoundingClientRect().height);
  expect(Math.round(height)).toBeGreaterThanOrEqual(224);
  expect(Math.round(height)).toBeLessThanOrEqual(232);

  const spend = content(page).getByRole('region', { name: 'Spend by system' });
  await expect(spend).toContainText('$3,782');
  await expect(spend.locator('.spend__row')).toHaveText([/Digital Teammates\s*\$1,816/, /Platform compute\s*\$1,140/, /Product Factory\s*\$412/, /Software Factory\s*\$318/, /Knowledge\s*\$96/]);

  const rows = content(page).getByRole('region', { name: 'Who does the work', exact: true }).locator('tbody tr');
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText('78% agents · 22% people');
  await expect(rows.nth(1).locator('td')).toHaveText([/^Architecture/, '62% agents · 38% people', '2.6 d', /^5\.8 d/, '12%']);
  await expect(rows.nth(4).locator('td')).toHaveText([/^Ship/, '35% agents · 65% people', '0.4 d', '1.1 d', '3%']);
  await expectNoAxeViolations(page, 'Metrics');

  // Another period: the page stays (no reload), the numbers and the address follow.
  await page.evaluate(() => { window.__nooblyNoReload = 'still here'; });
  await content(page).getByRole('button', { name: 'Quarter' }).click();
  await expect(content(page).locator('.lead')).toContainText('Last quarter (90 days).');
  await expect(tiles.nth(1)).toContainText('45');
  await expect(page).toHaveURL(/\/home\/metrics\?range=quarter$/);
  await expect(content(page).getByRole('button', { name: 'Quarter' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__nooblyNoReload)).toBe('still here');
  await page.reload();
  await expect(content(page).getByRole('button', { name: 'Quarter' })).toHaveAttribute('aria-pressed', 'true');
  await expect(content(page).locator('.metrics__foot')).toContainText('Computed from the event log at');
});

test('at phone width the Home screens have no sideways scroll and controls stay at least 44px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, 'stevie');
  for (const path of ['/home/overview', '/home/lifecycle', '/home/lifecycle/PRD-031', '/home/approvals', '/home/activity', '/home/metrics', '/dev/clock']) {
    await page.goto(path);
    await expect(content(page).locator('h1')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
    const small = await page.locator('#noobly-content .btn, #noobly-content .chip, #noobly-content select, #noobly-content input').evaluateAll((els) => els
      .filter((e) => e.offsetParent !== null)
      .map((e) => ({ text: (e.textContent || e.name).trim().slice(0, 20), h: e.getBoundingClientRect().height }))
      .filter((r) => r.h < 44));
    expect(small, `${path}: controls under 44px`).toEqual([]);
  }
});

test('step 6: Priya (Contributor) is told she can\'t approve the ADR, and the API refuses her too', async ({ page }) => {
  await signIn(page, 'priya-s');
  await page.goto('/home/approvals?tab=others&id=apr_adr014');
  const detail = content(page).getByRole('region', { name: 'Selected approval' });
  await expect(detail).toContainText('You can\'t approve this: Architecture decision needs the "accept-decisions" permission, and your access role is Contributor.');
  await expect(detail.getByRole('button', { name: /Accept|Approve/ })).toHaveCount(0);
  const status = await page.evaluate(async () => {
    const token = decodeURIComponent(/noobly\.csrf=([^;]+)/.exec(document.cookie)[1]);
    const res = await fetch('/workflows/api/v1/approvals/apr_adr014/decision', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': token }, body: JSON.stringify({ decision: 'approve' }) });
    return res.status;
  });
  expect(status).toBe(403);
  await expectNoAxeViolations(page, 'Approvals as a Contributor');
});

test('steps 3 and 4: approving needs an override reason, then PRD-031 moves and a second browser sees it live', async ({ browser }) => {
  const stevie = await (await browser.newContext()).newPage();
  const lerato = await (await browser.newContext()).newPage();
  await signIn(stevie, 'stevie');
  await signIn(lerato, 'lerato-m');
  await lerato.goto('/home/activity');
  await expect(content(lerato).locator('.timeline__row').first()).toBeVisible();
  await lerato.evaluate(() => { window.__nooblyNoReload = 'still here'; });

  await stevie.goto('/home/approvals');
  const detail = content(stevie).getByRole('region', { name: 'Selected approval' });
  await detail.getByRole('button', { name: 'Approve & send to Architecture' }).click();
  await expect(detail.getByRole('alert')).toContainText("PRD-031 isn't ready: 6 of 7 checks pass (Rollout plan missing)");
  await detail.getByLabel(/To approve anyway, say why/).fill('Rollout plan follows in the pilot review');
  await detail.getByRole('button', { name: 'Approve & send to Architecture' }).click();
  await expect(detail.getByRole('status')).toHaveText('Approved. PRD-031 moved to Architect.');
  await expect(stevie.getByRole('button', { name: 'Waiting on you 3' })).toBeVisible();
  await expect(stevie.locator('#noobly-sidebar [data-nav="approvals"] .nav__badge')).toContainText('3');

  // Step 4: Lerato's Activity page shows it without a refresh.
  const timeline = content(lerato).getByRole('region', { name: 'Timeline' });
  await expect(timeline).toContainText('Stevie approved PRD-031 · Same-day delivery slots with a readiness override');
  await expect(timeline).toContainText('Stevie moved PRD-031 · Same-day delivery slots to Architect');
  expect(await lerato.evaluate(() => window.__nooblyNoReload)).toBe('still here');

  await stevie.goto('/home/lifecycle');
  await expect(content(stevie).locator('.swimlane tbody tr', { hasText: 'PRD-031' }).locator('td').nth(2)).toContainText(/review|Architect/);
  await stevie.context().close();
  await lerato.context().close();
});

test('step 7: the dev clock moves time on; the reminder and the escalation show on the approval and in Lifecycle', async ({ page }) => {
  await signIn(page, 'stevie');
  await page.goto('/dev/clock');
  await expect(content(page)).toContainText('The clock has not been moved.');
  await expectNoAxeViolations(page, 'Dev clock');
  // Two working days on a weekday (the roadmap's script); a third covers a run on a weekend.
  await page.getByRole('button', { name: '+2 working days' }).click();
  await expect(content(page).getByRole('status')).toContainText('Moved forward');
  await page.getByRole('button', { name: '+1 working day' }).click();
  await expect(content(page)).toContainText('Moved ahead');

  await page.goto('/home/approvals?tab=others&id=apr_prd029spec');
  const detail = content(page).getByRole('region', { name: 'Selected approval' });
  await expect(detail.locator('.late')).toContainText('Reminder sent to Lerato M.');
  await expect(detail.locator('.late')).toContainText('Escalated to Stevie');
  await page.goto('/home/approvals?tab=others&id=apr_adr015');
  await expect(detail.locator('.late')).toContainText('Reminder sent to Thabo N.');
  await expect(detail.locator('.late')).not.toContainText('Escalated');
  await expectNoAxeViolations(page, 'Approvals with a reminder');

  await page.goto('/home/lifecycle');
  await expect(content(page).locator('.swimlane tbody tr', { hasText: 'PRD-029' }).locator('.swimlane__cell--waiting')).toBeVisible();
  await expect(content(page).locator('.swimlane tbody tr', { hasText: 'PRD-027' }).locator('.swimlane__cell--waiting')).toBeVisible();
  await page.goto('/home/activity');
  await expect(content(page).getByRole('region', { name: 'Timeline' })).toContainText("escalated PRD-029's spec approval to stevie");
});

test('step 8: PRD-027 is sent back to Specify with a reason, and Sent back for changes goes up by 1', async ({ page }) => {
  await signIn(page, 'stevie');
  await page.goto('/home/lifecycle');
  const sentBack = content(page).locator('.tally__sent-back dd');
  const before = Number(await sentBack.textContent());
  await page.goto('/home/lifecycle/PRD-027');
  const form = content(page).locator('[data-form="send-back"]');
  await form.getByLabel('Send back to').selectOption('specify');
  await form.getByLabel('Why is it going back?').fill('Needs the courier privacy review first');
  await form.getByRole('button', { name: 'Send back' }).click();
  await expect(content(page).getByRole('status')).toHaveText('PRD-027 is back in Specify.');
  await expect(content(page).locator('.history__row').first()).toContainText('Sent back from Architect to Specify: Needs the courier privacy review first');
  await page.goto('/home/lifecycle');
  await expect(sentBack).toHaveText(String(before + 1));
  await expect(content(page).locator('.swimlane tbody tr', { hasText: 'PRD-027' }).locator('td').nth(1).locator('.swimlane__cell')).toBeVisible();
  await page.goto('/dev/clock');
  await page.getByRole('button', { name: 'Reset to real time' }).click();
  await expect(content(page)).toContainText('The clock has not been moved.');
});
