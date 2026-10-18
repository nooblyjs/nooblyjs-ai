// Phase 6 in a real browser (roadmap Phase 6 test script): the Teammates roster with its ninth teammate, a paused
// teammate in team chat, and the NooblyJS Teams bot in the simulator at /dev/teams: who to add, a teammate joining,
// an answer card that only links into NooblyJS, and swapping one teammate for another. With axe and phone width.
// No model is configured, so every answer is the scripted one. test/teams-bot.test.js covers the same steps
// through the bot's endpoint.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const content = (page) => page.locator('#noobly-content');
const chat = (page) => page.locator('#noobly-chat');
const log = (page) => content(page).getByRole('log', { name: 'Messages' });
const box = (page) => content(page).getByRole('textbox', { name: 'Type a message' });

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
async function say(page, text) {
  await box(page).fill(text);
  await box(page).press('Enter');
}

test('step 1: Teammates on the rail opens the roster in the frame, with Rhea Voss as the ninth teammate', async ({ page }) => {
  await signIn(page, 'stevie');
  await page.evaluate(() => { window.__nooblyNoReload = 'still here'; });
  await page.locator('#noobly-rail').getByRole('link', { name: /Teammates/ }).click();
  await expect(page).toHaveURL(/\/teammates\/team$/);
  await expect(content(page)).toContainText('Rhea Voss');
  await expect(content(page)).toContainText('Architect');
  await expect(content(page)).toContainText('Sable Reyes');
  expect(await page.evaluate(() => window.__nooblyNoReload)).toBe('still here');
});

test('step 3: mentioning a paused teammate gets a clear "paused" line from NooblyJS, and no agent reply', async ({ page }) => {
  await signIn(page, 'lerato-m');
  await page.goto('/home/lifecycle/PRD-030');
  await expect(chat(page).getByRole('heading', { name: 'Team chat' })).toBeVisible();
  const message = chat(page).getByRole('textbox', { name: /Message PRD-030/ });
  await message.fill('@Sable can you write the headline?');
  await message.press('Enter');
  await expect(chat(page).locator('.chat-line').last()).toContainText("Sable Reyes didn't pick this up. Sable Reyes is paused. Resume them to assign work. Nothing was billed.");
  await expect(chat(page).locator('.chat-msg--agent')).toHaveCount(0);
});

test('steps 4 to 8: @NooblyJS asks who to add; Ada joins and answers Lerato with a card that links into NooblyJS; Rhea replaces her', async ({ browser }) => {
  const stevie = await (await browser.newContext()).newPage();
  const lerato = await (await browser.newContext()).newPage();
  await signIn(stevie, 'stevie');
  await signIn(lerato, 'lerato-m');

  // The stand-in meeting: what was said before anyone added the bot is shown, and never sent to it.
  await stevie.goto('/dev/teams');
  await expect(content(stevie).getByRole('heading', { level: 1, name: 'Teams simulator' })).toBeVisible();
  await expect(content(stevie).getByRole('heading', { level: 2, name: 'Slot rollout sync' })).toBeVisible();
  await expect(log(stevie)).toContainText("Agenda: where are we on the slot rollout, and what's still blocking the pilot?");
  await expect(log(stevie)).toContainText('Earlier messages are not sent to the bot');
  await expect(content(stevie).getByRole('status')).toHaveText('No teammate is in this chat. Type @NooblyJS to add one.');
  await expectNoAxeViolations(stevie, 'the simulator before the bot is added');

  // Step 4: @NooblyJS → the pick-a-teammate card.
  await say(stevie, '@NooblyJS');
  const pick = log(stevie).locator('.ac-card').last();
  await expect(pick).toContainText('Which teammate would you like to add to this meeting?');
  // Role, status and rate. The status is live: the earlier specs gave Ada and Rhea work, which they have finished.
  await expect(pick).toContainText(/Research Analyst · (On a task|Available) · [$]48[/]hr/);
  await expect(pick).toContainText(/Architect · (On a task|Available) · [$]52[/]hr/);
  await expect(pick).toContainText('The teammate sees messages from the moment they join, not before. Time is billed to Delivery squad.');
  await expect(pick.getByRole('button', { name: 'Add' })).toHaveCount(7);
  await expect(pick.locator('.ac-columns', { hasText: 'Sable Reyes' })).toContainText("Can't join now");
  await expect(box(stevie)).toHaveValue('');
  await expectNoAxeViolations(stevie, 'the pick-a-teammate card');

  // Step 5: Add on Ada → the "joined" line, who added her, her introduction, and who pays.
  await pick.locator('.ac-columns', { hasText: 'Ada Quill' }).getByRole('button', { name: 'Add' }).click();
  await expect(log(stevie).locator('.tsim__line').last()).toHaveText('Ada Quill joined the chat');
  await expect(log(stevie)).toContainText('Ada Quill was added by Stevie. Mention @Ada to ask a question.');
  await expect(log(stevie).locator('.ac-card').last()).toContainText("Hi all, I'm Ada. I've loaded PRD-031 and the Delivery squad's latest activity from NooblyJS.");
  await expect(log(stevie).locator('.ac-card').last()).toContainText('NooblyJS teammate');
  await expect(content(stevie).locator('.tsim__meta')).toContainText('Added by Stevie · billed to Delivery squad · loaded PRD-031');
  await expect(content(stevie).getByRole('status')).toHaveText('Ada is listening · mention @Ada to ask');

  // Step 6: Lerato asks; Stevie sees the answer arrive without a refresh.
  await lerato.goto('/dev/teams');
  await expect(log(lerato)).toContainText('Ada Quill joined the chat');
  await say(lerato, "@Ada what's still blocking the slot pilot?");
  const answer = log(lerato).locator('.ac-card').last();
  await expect(answer).toContainText('Here is where PRD-031 stands.');
  await expect(answer).toContainText('PRD-031 · Same-day delivery slots');
  await expect(answer.locator('.ac-fact', { hasText: 'Readiness' })).toContainText('of 7 checks');
  await expect(answer.locator('.ac-fact', { hasText: 'Waiting on' })).toBeVisible();
  await expect(answer).toContainText('Sources: PRD-031, ADR-014 · this answer cost $0.06 · billed to Delivery squad');
  // Both actions are links into NooblyJS. Nothing on the card decides.
  await expect(answer.getByRole('link', { name: 'Open in NooblyJS' })).toHaveAttribute('href', /\/home\/lifecycle\/PRD-031$/);
  await expect(answer.getByRole('link', { name: 'Ask Thabo to decide' })).toHaveAttribute('href', /\/home\/approvals$/);
  await expect(answer.getByRole('button')).toHaveCount(0);
  await expect(log(stevie).locator('.ac-card').last()).toContainText('this answer cost $0.06');
  await expect(log(stevie)).toContainText("@Ada what's still blocking the slot pilot?");
  await expectNoAxeViolations(lerato, 'the answer card');

  // Phone width: the chat stacks and nothing scrolls sideways.
  await lerato.setViewportSize({ width: 375, height: 800 });
  expect(await lerato.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await lerato.setViewportSize({ width: 1280, height: 800 });

  // "Ask Thabo to decide" opens NooblyJS's Approvals. The decision is taken there, by a person.
  await answer.getByRole('link', { name: 'Ask Thabo to decide' }).click();
  await expect(lerato).toHaveURL(/\/home\/approvals$/);
  await expect(content(lerato).getByRole('heading', { level: 1 })).toContainText('Approvals');

  // The meeting is in the item's thread.
  await lerato.goto('/home/lifecycle/PRD-031');
  await expect(chat(lerato)).toContainText("@Ada what's still blocking the slot pilot?");
  await expect(chat(lerato).locator('.chat-msg--agent').last()).toContainText('Here is where PRD-031 stands.');

  // Step 8: Choose someone else swaps Ada for Rhea.
  await log(stevie).getByRole('button', { name: 'Choose someone else' }).last().click();
  await expect(log(stevie).locator('.tsim__line').last()).toHaveText('Ada Quill left the chat');
  await log(stevie).locator('.ac-card').last().locator('.ac-columns', { hasText: 'Rhea Voss' }).getByRole('button', { name: 'Add' }).click();
  await expect(log(stevie).locator('.tsim__line').last()).toHaveText('Rhea Voss joined the chat');
  await expect(log(stevie).locator('.ac-card').last()).toContainText('Hi, Rhea here. I drafted the slot architecture and ADR-014.');
  await expect(content(stevie).getByRole('status')).toHaveText('Rhea is listening · mention @Rhea to ask');

  // The keyboard path: the composer is reachable and Enter sends.
  await box(stevie).focus();
  await stevie.keyboard.type('@Rhea can we hit 300 ms without adding Redis?');
  await stevie.keyboard.press('Enter');
  await expect(log(stevie).locator('.ac-card').last()).toContainText('ADR-014 · Cache slot availability');
  await expect(box(stevie)).toBeFocused();
});
