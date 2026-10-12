import type { Locator } from '@playwright/test';
import { test, expect, peer } from './fixtures';

// What the unit tests (happy-dom) cannot see: a real engine's layout, focus and
// event order. The mobile projects tap instead of click, which is where iOS
// differs — the toolbar and checkboxes act on synthesized mousedown.
//
// Text goes in with insertText, the way a phone's IME commits it. Synthetic
// Enter keys are not what a phone sends, and CodeMirror's mobile input paths
// (rightly) drop some of them.

test.beforeEach(async ({ page }) => {
  // A named peer: the mock pins its dev-tools panel over the mobile toolbar for
  // the default `device0`.
  await page.goto(peer('alice'));
  await page.locator('.cm-content').click();
});

const press = (target: Locator, isMobile: boolean): Promise<void> =>
  isMobile ? target.tap() : target.click();

test('renders markdown live as you type', async ({ page }) => {
  await page.keyboard.insertText('# Title\nsome **bold** text');
  // Off the cursor line the markers are hidden, so the heading reads clean.
  await expect(page.locator('.cm-line.md-h1')).toHaveText('Title');
  await expect(page.locator('.md-strong')).toContainText('bold');
  await expect(page.locator('#toolbar')).toBeInViewport();
});

test('toolbar formats the selection and keeps the editor focused', async ({ page, isMobile }) => {
  await page.keyboard.insertText('word');
  await page.keyboard.press('ControlOrMeta+a');
  await press(page.getByRole('button', { name: 'Bold' }), isMobile);
  await expect(page.locator('.md-strong')).toContainText('word');
  // Losing focus here would drop the on-screen keyboard after every tap.
  await expect(page.locator('.cm-editor')).toHaveClass(/cm-focused/);
});

test('a checkbox toggles its task', async ({ page, isMobile }) => {
  await page.keyboard.insertText('- [ ] task\n');
  const box = page.locator('.md-task-checkbox');
  await press(box, isMobile);
  await expect(box).toBeChecked();
});

test('a raw <script> block is highlighted like a ```js fence', async ({ page }) => {
  // lang-html highlights <script> through src/lang-javascript-lite.ts, which
  // stands in for lang-javascript (see AGENTS.md). If an upgraded lang-html
  // needs more from it, this is where it breaks: only once a script is typed.
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.keyboard.insertText('```js\nconst a = 1;\n```\n\n<script>\nconst b = 2;\n</script>\n');
  const keyword = (line: string): Locator =>
    page.locator('.cm-line', { hasText: line }).getByText('const', { exact: true });
  const fenced = await keyword('const a = 1;').evaluate((el) => getComputedStyle(el).color);
  await expect(keyword('const b = 2;')).toHaveCSS('color', fenced);
  expect(errors).toEqual([]);
});

test('an edit made right before closing survives the relaunch', async ({ page }) => {
  await page.keyboard.insertText('keep me');
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('keep me');
});

test('peers see each other type', async ({ page, context }) => {
  const bob = await context.newPage();
  await bob.goto(peer('bob'));
  await expect(bob.locator('.cm-editor')).toBeVisible();
  // ponytail: the mock connects realtime 500ms after joining and drops frames
  // until then; there is nothing to wait on instead.
  await bob.waitForTimeout(600);
  await page.keyboard.insertText('hello bob');
  await expect(bob.locator('.cm-content')).toContainText('hello bob');
});
