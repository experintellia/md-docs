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

test('the toolbar and checkboxes work from the keyboard', async ({ page, isMobile }) => {
  test.skip(isMobile, 'no hardware keyboard to Tab with');
  await page.keyboard.insertText('word');
  await page.keyboard.press('ControlOrMeta+a');
  // Enter on a focused button fires only click, never the mousedown a pointer sends.
  await page.getByRole('button', { name: 'Bold' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.md-strong')).toContainText('word');

  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('\n- [ ] task\n');
  const box = page.getByRole('checkbox', { name: 'Done' });
  await box.focus();
  await page.keyboard.press('Space');
  await expect(box).toBeChecked();
  // Focus stays on the box, so Space again unticks it.
  await expect(box).toBeFocused();
  await page.keyboard.press('Space');
  await expect(box).not.toBeChecked();
  // A mouse press ticks on mousedown, and CodeMirror re-inserts the box, so
  // no click follows. The keyboard must still work on it afterwards.
  await box.click();
  await expect(box).toBeChecked();
  await box.focus();
  await page.keyboard.press('Space');
  await expect(box).not.toBeChecked();
  // Tab leaves the box; it doesn't indent the line at the editor's caret.
  const before = await page.locator('.cm-content').innerText();
  await page.keyboard.press('Tab');
  await expect(box).not.toBeFocused();
  expect(await page.locator('.cm-content').innerText()).toBe(before);
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

test('$$ in the middle of a line typesets below the text, as in Obsidian', async ({ page, isMobile }) => {
  // The second runs over three lines of its paragraph, closed by a `$$` alone.
  await page.keyboard.insertText('hello $$ E = mc^2 $$\n\nWe get $$\na^2\n$$\n\nafter');
  const math = page.locator('.md-math');
  await expect(math.locator('.katex')).toHaveCount(2);
  await expect(math.locator('.katex-error')).toHaveCount(0);
  for (const [i, word] of ['hello', 'We get'].entries()) {
    const line = page.locator('.cm-line', { hasText: word });
    const bottom = await line.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el.firstChild!);
      return range.getBoundingClientRect().bottom;
    });
    expect((await math.nth(i).boundingBox())!.y).toBeGreaterThanOrEqual(bottom - 1);
  }
  await press(math.nth(1).locator('.katex'), isMobile);
  await expect(math).toHaveCount(1);
  await expect(page.locator('.cm-content')).toContainText('a^2');
});

test('$ … $ typesets in the line, and money stays text', async ({ page, isMobile }) => {
  await page.keyboard.insertText(String.raw`the area is $\pi r^2$, roughly` + '\n\nfrom $5 to $10\n\nafter');
  const math = page.locator('.md-math-inline');
  await expect(math.locator('.katex')).toHaveCount(1);
  await expect(math.locator('.katex-error')).toHaveCount(0);
  const line = page.locator('.cm-line', { hasText: 'the area is' });
  await expect(line).toContainText('roughly');
  // On the line, not below it: the formula is within the line's own box.
  const [box, lineBox] = [await math.boundingBox(), await line.boundingBox()];
  expect(box!.y).toBeGreaterThanOrEqual(lineBox!.y - 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(lineBox!.y + lineBox!.height + 1);
  await expect(page.locator('.cm-content')).toContainText('from $5 to $10');
  await press(math.locator('.katex'), isMobile);
  await expect(math).toHaveCount(0);
  await expect(page.locator('.cm-content')).toContainText(String.raw`$\pi r^2$`);
});

test('math in a table cell typesets in the table', async ({ page }) => {
  await page.keyboard.insertText('| a | b |\n|---|---|\n| $x^2$ | $5 |\n\nafter');
  const table = page.locator('.md-table');
  await expect(table.locator('.md-math-inline .katex')).toHaveCount(1);
  await expect(table.locator('.katex-error')).toHaveCount(0);
  await expect(table.locator('td').nth(1)).toHaveText('$5');
});

test('a negative size in TeX cannot make its line endlessly tall', async ({ page }) => {
  // KaTeX caps positive sizes only: this made a line 33 million px tall.
  await page.keyboard.insertText(String.raw`a $\raisebox{-99999999em}{X}$ b` + '\n\n$$\\rule[-99999em]{1em}{1em}$$\n\nafter');
  await expect(page.locator('.md-math-inline .katex')).toHaveCount(1);
  await expect(page.locator('.md-math .katex')).toHaveCount(1);
  const tallest = await page.locator('.cm-line').evaluateAll((lines) => Math.max(...lines.map((l) => l.clientHeight)));
  expect(tallest).toBeLessThan(2000);
});

test('a $$ formula in a table cell gets the width it needs', async ({ page }) => {
  await page.keyboard.insertText(String.raw`| a | b |
|---|---|
| x | $$\int_0^1 f(x)\,dx = F(1)-F(0)$$ |
| y | ok |

after`);
  const math = page.locator('.md-table .md-math');
  await expect(math.locator('.katex')).toHaveCount(1);
  // Not squashed to the column's other content behind a scrollbar.
  expect(await math.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});

test('tapping a formula while the editor is not focused focuses it, so typing lands', async ({ page, isMobile }) => {
  // On a phone this is how the keyboard opens: there is no caret to tap beside.
  await page.keyboard.insertText(String.raw`the area is $\pi r^2$, roughly` + '\n\nafter');
  const math = page.locator('.md-math-inline');
  await expect(math.locator('.katex')).toHaveCount(1);
  await page.locator('.cm-content').blur();
  await expect(page.locator('.cm-editor')).not.toHaveClass(/cm-focused/);
  await press(math.locator('.katex'), isMobile);
  await expect(math).toHaveCount(0);
  await expect(page.locator('.cm-editor')).toHaveClass(/cm-focused/);
  await page.keyboard.insertText('2');
  await expect(page.locator('.cm-content')).toContainText(String.raw`the area is 2$\pi r^2$`);
});

test('a wide inline formula scrolls on its own, not the whole editor', async ({ page }) => {
  // Nothing like `+` or `=` to break at, so KaTeX cannot wrap it.
  const tex = Array.from({ length: 40 }, (_, i) => `a_{${i}}`).join('');
  await page.keyboard.insertText(`wide $${tex}$ end\n\nafter`);
  await expect(page.locator('.md-math-inline .katex')).toHaveCount(1);
  const { scrollWidth, clientWidth } = await page.locator('.cm-scroller')
    .evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});

test('arrow keys move the caret the way a right-to-left line reads', async ({ page }) => {
  // The caret ends at the Arabic word's logical end, which is its left edge, so
  // ArrowRight steps back into the word and ArrowLeft forward. Without
  // perLineTextDirection the line is moved through as if LTR, and Y lands at
  // the far end: مYرحبXا.
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

test('a click in the space below the text puts the cursor at the end', async ({ page, isMobile }) => {
  // Taller than the screen, so the room below it is the scroller's padding to
  // scroll past the end, not .cm-content stretched to fill the editor.
  await page.keyboard.insertText('line\n'.repeat(60) + 'last');
  await page.keyboard.press('ControlOrMeta+Home');
  const editor = page.locator('#editor');
  await page.locator('.cm-scroller').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const box = (await editor.boundingBox())!;
  const point = { x: box.x + box.width / 2, y: box.y + box.height - 20 };
  if (isMobile) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await page.keyboard.insertText('!');
  await expect(page.locator('.cm-content')).toContainText('last!');
});

test('a drag from the text into the space below keeps its selection', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a touch drag scrolls instead of selecting');
  await page.keyboard.insertText('line\n'.repeat(60) + 'last');
  await page.locator('.cm-scroller').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const from = (await page.locator('.cm-line', { hasText: 'last' }).boundingBox())!;
  const box = (await page.locator('#editor').boundingBox())!;
  await page.mouse.move(from.x + 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 20, { steps: 5 });
  await page.mouse.up();
  // Typing replaces the selected "last"; a caret at the end would append.
  await page.keyboard.insertText('!');
  await expect(page.locator('.cm-content')).not.toContainText('last');
});
