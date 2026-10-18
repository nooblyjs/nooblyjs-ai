// Roadmap Phase 8 in a real browser: the Wiki Platform hosted at /wiki as NooblyJS's Knowledge Repository. The seeded
// sample export shows on Sources with what was redacted; a question is answered from three cited sources; the
// answer is added to PRD-031 and then reported as wrong, which puts its documents on Needs review and on the spec;
// and the L0 process model draws from the imported pages and drills down. No AI agent is configured, so answers
// are the sources' own passages. The new screens and blocks are scanned with axe (WCAG 2.2 AA): the scan is
// scoped to them, because the rest of the wiki's own UI is not part of this phase.
// test/knowledge.test.js covers the same steps through the API, and the draft that cites knowledge (step 6).
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const content = (page) => page.locator('#noobly-content');
const L0 = '/wiki/#/Enterprise%20Space/Business%20processes/L0%20Enterprise%20Process%20Model.md';

async function signIn(browser, personId) {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.locator(`button[name="personId"][value="${personId}"]`).click();
  await expect(content(page).locator('h1')).toBeVisible();
  return page;
}
async function expectNoAxeViolations(page, selector, label) {
  const result = await new AxeBuilder({ page }).include(selector).withTags(AA).analyze();
  const summary = result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')})`);
  expect(summary, `axe on ${label}`).toEqual([]);
}

/**
 * Opens a wiki page. A person's first visit to the wiki gets its own "Welcome aboard" setup dialog over the page:
 * skip it, as a person would, so the page underneath can be used.
 */
async function openWiki(page, url) {
  await page.goto(url);
  const skip = page.getByText('Skip setup');
  await skip.waitFor({ state: 'visible', timeout: 6000 }).then(() => skip.click()).catch(() => {});
  await expect(page.locator('.obA-scrim')).toHaveCount(0);
}
/** The wiki's AI panel, open: it remembers whether it was open, so only press the toggle when it is not. */
async function aiPanel(page) {
  const input = page.locator('#aiChatInput');
  if (!(await input.isVisible())) await page.locator('#aiChatToggleBtn').click();
  await expect(input).toBeVisible();
  return input;
}

test.describe.configure({ mode: 'serial' });

let stevie; // Owner
let lerato; // Approver, Product manager

test.beforeAll(async ({ browser }) => {
  stevie = await signIn(browser, 'stevie');
  lerato = await signIn(browser, 'lerato-m');
});
test.afterAll(async () => {
  for (const page of [stevie, lerato]) await page?.context().close();
});

test('step 1 and 5: Sources shows the imported sample, its document counts and what was redacted; an Owner can import again', async () => {
  // Hosted-app checklist: the rail opens the Wiki without reloading the page.
  await stevie.evaluate(() => { window.__nooblyNoReload = 'still here'; });
  await stevie.locator('#noobly-rail').getByRole('link', { name: /Wiki/ }).first().click();
  await expect(stevie).toHaveURL(/\/wiki\/?/);
  expect(await stevie.evaluate(() => window.__nooblyNoReload)).toBe('still here');

  await stevie.goto('/wiki/datasources/sources');
  const table = content(stevie).getByRole('table', { name: 'Sources and their last import' });
  await expect(table).toContainText('Sample wiki export');
  await expect(table).toContainText('Imported');
  await expect(table).toContainText('18 documents');
  await expect(table).toContainText('Enterprise Space: 13 · Acme Retail Space: 5');
  await expect(table).toContainText('3 values redacted: 1 email address, 1 phone number, 1 ID number');
  await expectNoAxeViolations(stevie, '[data-region="body"]', 'Wiki · Sources');
  await table.getByRole('button', { name: 'Import Sample wiki export again' }).click();
  await expect(content(stevie)).toContainText('18 documents imported from 1 source');
  // A deep link and a refresh land on the same screen.
  await stevie.reload();
  await expect(content(stevie).getByRole('table', { name: 'Sources and their last import' })).toBeVisible();
  // Someone who is not an Owner sees the sources and no import button.
  await lerato.goto('/wiki/datasources/sources');
  await expect(content(lerato).getByRole('table', { name: 'Sources and their last import' })).toContainText('Sample wiki export');
  await expect(content(lerato).getByRole('button', { name: /Import/ })).toHaveCount(0);
});

test('step 2: "How is slot capacity calculated?" is answered with 3 citations; Add to item puts them on PRD-031', async () => {
  await openWiki(lerato, '/wiki/');
  const input = await aiPanel(lerato);
  const scoped = lerato.locator('#aiChatScopeToggle');
  if (await scoped.isVisible() && await scoped.isChecked()) await scoped.uncheck();
  await input.fill('How is slot capacity calculated?');
  await input.press('Enter');
  const messages = lerato.locator('#aiChatMessages');
  await expect(messages.locator('.ai-sources-list li')).toHaveCount(3, { timeout: 20_000 });
  await expect(messages).toContainText('Capacity per slot is pickers on shift multiplied by picks per hour');
  await expect(messages).toContainText('No model is configured here');
  await expect(messages.locator('.ai-sources-list li').first()).toContainText('Slot capacity model');

  const actions = messages.locator('.ai-answer-actions').last();
  await actions.getByRole('button', { name: 'Add to item' }).click();
  await actions.getByRole('textbox', { name: 'NooblyJS item' }).fill('PRD-031');
  await expectNoAxeViolations(lerato, '.ai-answer-actions', 'Wiki · answer actions (form open)');
  await actions.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(actions.getByRole('status')).toHaveText("Added 3 sources to PRD-031's linked knowledge.");

  await lerato.goto('/product/specs/PRD-031');
  await expect(content(lerato).locator('h1')).toBeVisible();
  await expect(content(lerato)).toContainText('Runbook · Acme Retail Space');
});

test('step 3: This is wrong puts the documents on Needs review and marks them on the spec; an Approver reviews one', async () => {
  await openWiki(lerato, '/wiki/');
  await aiPanel(lerato);
  const actions = lerato.locator('#aiChatMessages .ai-answer-actions').last();
  await expect(actions).toBeVisible({ timeout: 20_000 }); // the answer is in her chat history, with its actions
  await actions.getByRole('button', { name: 'This is wrong' }).click();
  await actions.getByRole('textbox', { name: 'What is wrong with this answer?' }).fill('It leaves out the van cap.');
  await actions.getByRole('button', { name: 'Report' }).click();
  await expect(actions.getByRole('status')).toHaveText('Reported. 3 documents are flagged for review.');

  await lerato.goto('/wiki/datasources/needs-review');
  const table = content(lerato).getByRole('table', { name: 'Documents that need review' });
  await expect(table.locator('tbody tr')).toHaveCount(3);
  await expect(table).toContainText('It leaves out the van cap.');
  await expect(table).toContainText('Lerato M.');
  await expectNoAxeViolations(lerato, '[data-region="body"]', 'Wiki · Needs review');
  await table.getByRole('button', { name: 'Mark Slot capacity model as reviewed' }).click();
  await expect(content(lerato).getByRole('table', { name: 'Documents that need review' }).locator('tbody tr')).toHaveCount(2);

  await lerato.goto('/product/specs/PRD-031');
  await expect(content(lerato)).toContainText('Flagged: It leaves out the van cap.');
});

test('step 4: Enterprise Space → L0 draws three bands from the imported pages; Supply drills down; Used across NooblyJS lists PRD-031 and ADR-014', async () => {
  await openWiki(lerato, L0);
  const model = lerato.locator('.kr-process-model');
  await expect(model.getByRole('heading', { level: 3 })).toHaveText(['Enterprise', 'Value chain', 'Support', 'Used across NooblyJS'], { timeout: 20_000 });
  await expect(model.locator('.kr-pm-band').nth(1).getByRole('link')).toHaveCount(4);
  const used = model.getByRole('region', { name: 'Used across NooblyJS' });
  await expect(used.getByRole('link', { name: 'PRD-031' })).toHaveAttribute('href', '/home/lifecycle/PRD-031');
  await expect(used).toContainText('ADR-014');
  await expectNoAxeViolations(lerato, '.kr-process-model', 'Wiki · L0 process model');

  await model.getByRole('link', { name: /^Supply/ }).click();
  const supply = lerato.locator('.kr-process-model');
  await expect(supply.getByRole('heading', { name: 'Processes under Supply' })).toBeVisible({ timeout: 20_000 });
  await expect(supply.locator('.kr-pm-children').getByRole('link')).toHaveText([/Plan store replenishment/, /Manage delivery capacity/, /Distribute to stores/]);
  await expect(supply.getByRole('navigation', { name: 'Where this process sits' })).toContainText('L0 · Enterprise Process Model');
  await expectNoAxeViolations(lerato, '.kr-process-model', 'Wiki · L1 process model');

  // Opening the model's URL directly, and refreshing, lands on the same page.
  await openWiki(lerato, L0);
  await lerato.reload();
  await expect(lerato.locator('.kr-process-model').getByRole('heading', { name: 'Value chain' })).toBeVisible({ timeout: 20_000 });
  // Not checked at phone width: with its AI panel open, the wiki's own layout hides the page at 900px and below.
});

test('Architecture · Knowledge: an architect searches Knowledge for a folder and a file, links them with what each is for, edits a note, removes one', async () => {
  await lerato.goto('/product/architecture/PRD-031?tab=knowledge');
  await expect(content(lerato).getByRole('tab', { name: 'Knowledge' })).toHaveAttribute('aria-selected', 'true');
  // Knowledge comes before Repositories.
  const tabs = await content(lerato).getByRole('tab').allInnerTexts();
  expect(tabs.indexOf('Knowledge')).toBe(tabs.indexOf('Repositories') - 1);
  const mine = content(lerato).getByRole('region', { name: 'Knowledge for PRD-031' });
  await expect(mine).toContainText('None yet');

  const add = content(lerato).getByRole('region', { name: 'Add knowledge' });
  await add.getByRole('searchbox', { name: 'Search Knowledge' }).fill('standards');
  const folders = add.getByRole('list', { name: 'Folders that match' });
  await expect(folders).toContainText('[Enterprise Space]\\Standards');
  await add.getByLabel(/What is it for\?/).fill('Data relating to application standard');
  await folders.getByRole('button', { name: 'Link folder Standards' }).click();
  await expect(content(lerato).getByRole('status')).toContainText('Linked Standards to PRD-031.');
  await expect(mine.getByRole('listitem')).toHaveCount(1);
  await expect(mine).toContainText('Data relating to application standard');
  await expect(add.getByLabel(/What is it for\?/)).toHaveValue('', { timeout: 5000 });

  await add.getByRole('searchbox', { name: 'Search Knowledge' }).fill('integration standard');
  const files = add.getByRole('list', { name: 'Files that match' });
  await expect(files).toContainText('[Enterprise Space]\\Standards\\Integration standard v2.md');
  await files.getByRole('button', { name: /^Link file Integration standard/ }).first().click();
  await expect(mine.getByRole('listitem')).toHaveCount(2);
  await expect(mine).toContainText('No note on what it is for.');
  await expectNoAxeViolations(lerato, '#noobly-content', 'Architecture · Knowledge');

  await mine.getByRole('button', { name: /^Edit the note on Integration standard/ }).click();
  const note = mine.getByRole('form', { name: /^Note on Integration standard/ });
  await note.getByLabel('What is it for?').fill('How services talk to each other');
  await note.getByRole('button', { name: 'Save note' }).click();
  await expect(content(lerato).getByRole('status')).toContainText('Saved the note on Integration standard');
  await expect(mine).toContainText('How services talk to each other');

  await mine.getByRole('button', { name: 'Remove Standards' }).click();
  await expect(content(lerato).getByRole('status')).toContainText('Removed. Nothing changed in Knowledge.');
  await expect(mine.getByRole('listitem')).toHaveCount(1);
});
