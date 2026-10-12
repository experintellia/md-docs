import { test, expect, peer, press } from './fixtures';

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
