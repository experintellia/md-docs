import type { Locator } from '@playwright/test';
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

test('a $$ block typesets, with its fonts, and a tap opens its source', async ({ page, isMobile }) => {
  // The example from #27, verbatim: a bare `\\` between two lines.
  await page.keyboard.insertText(String.raw`$$
\Omega = \{ (\omega_1 , \omega_2) \, | \, \omega \in \{1,2,3\} \}
\\
\Omega = \{ (1,2), (1,3), (2,1), (2,3), (3,1), (3,2) \}
$$

after`);
  const math = page.locator('.md-math');
  await expect(math.locator('.katex-newline')).toHaveCount(1);
  await expect(math.locator('.katex-error')).toHaveCount(0);
  // The bundled fonts have their hinting and glyph names stripped (see
  // scripts/strip-katex-fonts.py), and each engine has its own font parser:
  // every face the formula used must have loaded, not been rejected.
  await expect.poll(() => page.evaluate(() => [...document.fonts]
    .filter((f) => f.family.replace(/"/g, '').startsWith('KaTeX') && f.status !== 'unloaded')
    .map((f) => `${f.family.replace(/"/g, '')} ${f.style} ${f.status}`).sort()))
    .toEqual(expect.arrayContaining(['KaTeX_Main normal loaded', 'KaTeX_Math italic loaded']));
  expect(await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'error').length)).toBe(0);
  await press(math.locator('.katex'), isMobile);
  await expect(math).toHaveCount(0);
  await expect(page.locator('.cm-content')).toContainText(String.raw`\Omega = \{ (1,2)`);
});

test('arrow keys move the caret the way a right-to-left line reads', async ({ page }) => {
  // The caret ends at the Arabic word's logical end, which is its left edge, so
  // ArrowRight steps back into the word. Were the line taken as LTR, as the
  // whole editor is without perLineTextDirection, it would leave the line.
  await page.keyboard.insertText('hello\nمرحبا');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.insertText('X');
  await expect(page.locator('.cm-line').nth(1)).toHaveText('مرحبXا');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.insertText('Y');
  await expect(page.locator('.cm-line').nth(1)).toHaveText('مرحبXاY');
});

test('right-to-left lines, quotes and tables sit on the right edge', async ({ page }) => {
  await page.keyboard.insertText('hello\n\nمرحبا\n\n> اقتباس\n\n| مصطلح | ترجمة |\n|---|---|\n| كتاب | book |\n\nend');
  // The space left and right of what an element holds. Zero-width boxes (a
  // hidden marker, a widget buffer) would otherwise pin a range to one edge.
  const gaps = (el: Locator): Promise<{ left: number; right: number }> => el.evaluate((box) => {
    const range = document.createRange();
    range.selectNodeContents(box);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0);
    const outer = box.getBoundingClientRect();
    return {
      left: Math.min(...rects.map((r) => r.left)) - outer.left,
      right: outer.right - Math.max(...rects.map((r) => r.right)),
    };
  });
  const line = (text: string): Locator => page.locator('.cm-line', { hasText: text });
  const ltr = await gaps(line('hello'));
  expect(ltr.left).toBeLessThan(ltr.right);
  for (const placed of [line('مرحبا'), line('اقتباس'), page.locator('.md-table-wrap')]) {
    const rtl = await gaps(placed);
    expect(rtl.right).toBeLessThan(rtl.left);
  }
  await expect(line('اقتباس')).toHaveCSS('border-right-width', '3px');
  await expect(line('اقتباس')).toHaveCSS('border-left-width', '0px');
  // Columns read right to left: the first header is the rightmost.
  const [first, second] = await page.locator('.md-table th').evaluateAll((ths) =>
    ths.map((th) => th.getBoundingClientRect().left));
  expect(first).toBeGreaterThan(second);
});
