// The Team board (nooblyjs-ai-teammate, .claude/specs/team-board/) in a real browser, inside the NooblyJS frame: the seeded
// board, filters, a new Ask that wakes @Ada (the offline mock plays her scripted reply), signals, promoting a Finding
// to team memory, axe on both pages, and phone width.
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
  const result = await new AxeBuilder({ page }).include('#noobly-content').withTags(AA).analyze();
  const summary = result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')})`);
  expect(summary, `axe on ${label}`).toEqual([]);
}

test('the Team board: the seeded posts, filters, an Ask that wakes @Ada, a signal and a promoted Finding', async ({ page }) => {
  await signIn(page, 'stevie');
  await page.goto('/teammates/board');
  const view = content(page);
  await expect(view.getByRole('heading', { level: 1, name: 'Team board' })).toBeVisible();
  await expect(view.locator('.tmk-feed > li')).toHaveCount(7);
  await expect(view.getByRole('heading', { name: 'Working on now' })).toBeVisible();
  await expect(view.locator('.tmk-board__side')).toContainText('Checkout accessibility fixes');
  await expect(view.locator('.tmk-board__side')).toContainText('ADR-014');
  await expectNoAxeViolations(page, 'the board');

  // Filters: one kind, then one topic.
  await view.getByRole('group', { name: 'Filter by kind' }).getByRole('button', { name: /^Finding/ }).click();
  await expect(view.locator('.tmk-feed > li')).toHaveCount(1);
  await expect(page).toHaveURL(/kind=finding/);
  await view.getByRole('group', { name: 'Filter by kind' }).getByRole('button', { name: /^All/ }).click();
  await view.locator('.tmk-feed').getByRole('button', { name: 'Show posts on #slots' }).first().click();
  await expect(view.locator('.tmk-active-topic')).toContainText('#slots');
  await expect(view.locator('.tmk-feed > li')).toHaveCount(3);
  await view.getByRole('button', { name: 'Show every topic' }).click();

  // A new Ask that mentions Ada: she answers in the thread, as an agent, with what it cost.
  await view.getByRole('button', { name: 'New post' }).click();
  const form = view.locator('#board-compose');
  await form.getByRole('radio', { name: /^Ask/ }).check();
  await form.getByLabel('Topics').fill('item:PRD-031, #slots');
  await form.getByLabel('Post', { exact: true }).fill('@Ada what is still blocking the slot pilot?');
  await expectNoAxeViolations(page, 'the composer');
  await form.getByRole('button', { name: 'Post' }).click();
  await expect(view.locator('#board-compose')).toHaveCount(0);
  const mine = view.locator('.tmk-post').filter({ hasText: 'what is still blocking the slot pilot' });
  await expect(mine).toContainText('Ask · Open');
  await mine.getByRole('link', { name: /Open thread|1 reply/ }).click();
  await expect(page).toHaveURL(/\/teammates\/board\/pst_/);
  const reply = view.locator('.tmk-reply--agent').first();
  await expect(reply).toContainText('Ada Quill', { timeout: 15_000 });
  await expect(reply).toContainText('best answer');
  await expect(reply.locator('.tmk-tag').first()).toHaveText('Agent');
  await expect(reply).toContainText('cost $0.01');
  await expectNoAxeViolations(page, 'a post and its thread');

  // The asker marks Ada's reply as the answer.
  await reply.getByRole('button', { name: 'Mark as the answer' }).click();
  await expect(view.locator('.tmk-post .pill')).toContainText('Ask · Answered');

  // Back on the board: a Useful signal on Otis's Finding, then promote it to team memory.
  await view.getByRole('link', { name: 'Back to the Team board' }).click();
  const finding = view.locator('.tmk-post').filter({ hasText: '61 of the 412' });
  const useful = () => finding.getByRole('button', { name: /^Useful/ });
  await expect(useful()).toHaveAttribute('aria-pressed', 'false');
  await expect(useful()).toHaveText('Useful 3');
  await useful().click();
  await expect(useful()).toHaveAttribute('aria-pressed', 'true');
  await expect(useful()).toHaveText('Useful 4');
  await expect(useful()).toBeFocused();
  await finding.getByRole('link', { name: /Open thread|repl/ }).click();
  await view.getByRole('button', { name: 'Promote to team memory' }).click();
  await expect(view.locator('.tmk-post .pill')).toContainText('Finding · Promoted to team memory');
  await page.goto('/teammates/team-memory');
  await expect(view).toContainText('61 of the 412');
});

test('the Team board at phone width: one column, no sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'stevie');
  await page.goto('/teammates/board');
  await expect(content(page).getByRole('heading', { level: 1, name: 'Team board' })).toBeVisible();
  await expect(content(page).locator('.tmk-feed > li').first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
