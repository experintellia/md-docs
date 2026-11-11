import {
  test, expect, press, serveMockWebxdc, chat, editor, open, write, peer, UPDATES_KEY, REALTIME_UP, realtimeUp,
} from './fixtures';

// Bugs the app has had, pinned where they lived: in the wiring between
// modules, in CSS, or in how a real engine behaves. Bugs in a single module's
// logic are pinned by the unit tests beside it (src/**/*.test.ts).

const DRAFT_KEY = 'md-docs-draft'; // must match src/collab.ts

test('reopening the app publishes nothing', async ({ page, context }) => {
  // 0.1.11: the device draft was applied before the channel replay, so every
  // plain open re-sent the whole document as a fresh edit and fired the chat's
  // "updated the document" notification. It takes a messenger that hands the
  // log over after setUpdateListener returns, as real ones may; the mock
  // replays synchronously unless told otherwise.
  await serveMockWebxdc(context, `{
    const deliver = window.webxdc.setUpdateListener;
    window.webxdc.setUpdateListener = (cb, serial) =>
      new Promise((resolve) => setTimeout(() => resolve(deliver(cb, serial)), 50));
  }`);
  await open(page);
  await write(page, 'hello');
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY)).not.toBeNull();
  await page.reload(); // closing flushes the edit to the chat
  await expect(editor(page)).toContainText('hello');
  const published = await chat(page);
  expect(published).toEqual(['alice info summary']);

  // Twice: the second close flushes whatever the first reopen queued.
  await page.reload();
  await page.reload();
  await expect(editor(page)).toContainText('hello');
  expect(await chat(page)).toEqual(published);
});

test('watching someone else type publishes nothing', async ({ page, context }) => {
  // 0.1.11: every peer re-published what reached it over realtime, under its
  // own name, notifying the chat as if it had made the edit.
  await serveMockWebxdc(context, REALTIME_UP);
  await open(page);
  const bob = await context.newPage();
  await open(bob, 'bob');
  // First, bob's close does flush: an edit of his own goes out under his name.
  await write(bob, 'hi');
  await bob.reload();
  expect(await chat(bob)).toEqual(['bob info summary']);

  await realtimeUp(bob);
  await write(page, 'hello bob');
  await expect(editor(bob)).toContainText('hello bob');
  // Nothing new is published, so it came over realtime: the path under test.
  expect(await chat(page)).toEqual(['bob info summary']);
  await bob.reload(); // closing flushes whatever bob queued
  // His close sent no claim of his own. (His reopen may pass alice's edit on,
  // quietly; e2e/draft-resend.spec.ts covers what that sends.) Read on bob's
  // page, where his writes land first.
  expect((await chat(bob)).filter((u) => u.includes('summary'))).toEqual(['bob info summary']);
});

test('a device that joins an existing document shows it and keeps up', async ({ page, context }) => {
  // The editor used to start empty on a second device while the synced
  // document already held the text, so the next incoming edit landed at a
  // position the editor did not have ("Invalid change range").
  await serveMockWebxdc(context, REALTIME_UP);
  await open(page);
  await write(page, 'written before bob joined');
  await page.reload(); // into the chat log

  const bob = await context.newPage();
  await open(bob, 'bob');
  await expect(editor(bob)).toContainText('written before bob joined');
  await realtimeUp(bob);
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText(', and after');
  await expect(editor(bob)).toContainText('written before bob joined, and after');
});

test('runs on a read-only webxdc object, like the one Delta Chat provides', async ({ page, context }) => {
  // The history shim once wrapped webxdc in a Proxy. Delta Chat's methods are
  // read-only and non-configurable, which a Proxy may not report differently,
  // so the app died on a real device while the configurable mock was fine.
  await serveMockWebxdc(context, 'Object.freeze(window.webxdc);');
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await open(page);
  await write(page, 'still works');
  await page.reload();
  await expect(editor(page)).toContainText('still works');
  expect(errors).toEqual([]);
});

test('a draft that cannot be kept on the device says so', async ({ page, context }) => {
  // #26: with localStorage full or blocked, the crash net failed silently and
  // the status line still read "saved".
  await context.addInitScript((draftKey) => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string): void {
      // Peers' keys carry a prefix here (see serveMockWebxdc).
      if (key.endsWith(draftKey)) throw new DOMException('full', 'QuotaExceededError');
      setItem.call(this, key, value);
    };
  }, DRAFT_KEY);
  await open(page);
  await write(page, 'not backed up');
  await expect(page.locator('#status')).toHaveText('no device backup');
});

test('restoring an earlier version goes through the in-app dialog', async ({ page, isMobile }) => {
  // 0.1.8: restore asked via window.confirm, which the iOS webview suppresses
  // (it returns false), so restoring silently did nothing there.
  await open(page);
  await write(page, 'version one');
  await page.reload();
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('version two');
  await page.reload();
  await expect(editor(page)).toContainText('version two');

  // On a phone, history sits behind the ⋮ menu.
  const more = page.getByRole('button', { name: 'More' });
  if (await more.isVisible()) await press(more, isMobile);
  await press(page.getByRole('button', { name: 'Document history' }), isMobile);
  await press(page.locator('.hist-row').nth(1), isMobile); // newest first
  await press(page.locator('#history-overlay [data-act="restore"]'), isMobile);
  await press(page.locator('#confirm-overlay [data-act="ok"]'), isMobile);
  await expect(editor(page)).toContainText('version one');
  await expect(editor(page)).not.toContainText('version two');
});

test('a selection inside code is visible', async ({ page }) => {
  // 0.2.0: code backgrounds were opaque, and CodeMirror paints the selection
  // in a layer behind the text, so selecting inside code showed nothing.
  await open(page);
  await write(page, '```\nsome code\n```\ntext with `inline` code\n');
  for (const code of [page.locator('.cm-line.md-code-block').first(), page.locator('.md-inline-code')]) {
    const alpha = await code.evaluate((el) => {
      const channels = getComputedStyle(el).backgroundColor.match(/[\d.]+/g) ?? [];
      return channels.length === 4 ? Number(channels[3]) : 1;
    });
    expect(alpha, 'code lost its background').toBeGreaterThan(0);
    expect(alpha, 'an opaque code background hides the selection').toBeLessThan(1);
  }
});

test('on a phone the status line clears the toolbar and tasks are big enough to tap', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch layout');
  // 0.1.6: the status line overlaid the toolbar (a CSS source-order bug), and
  // task checkboxes were too small to hit with a finger.
  await open(page);
  await write(page, '- [ ] task\n');
  const status = (await page.locator('#status').boundingBox())!;
  const toolbar = (await page.locator('#toolbar').boundingBox())!;
  expect(status.y + status.height, 'status line overlaps the toolbar').toBeLessThanOrEqual(toolbar.y);
  // Scaled against its own line: 1.35 on touch, 1.15 on a desktop.
  const scale = await page.locator('.md-task-checkbox').evaluate((box) =>
    parseFloat(getComputedStyle(box).fontSize) / parseFloat(getComputedStyle(box.parentElement!).fontSize));
  expect(scale, 'checkbox is the desktop size').toBeGreaterThan(1.3);
});

test('a document waits for the stored updates, with a progress bar after 4 s', async ({ page, context }) => {
  // #59 review: nothing may show while the log replays, and the bar only on a
  // slow replay. This messenger takes 7 s to hand the log over.
  await serveMockWebxdc(context, `{
    const deliver = window.webxdc.setUpdateListener;
    window.webxdc.setUpdateListener = (cb, serial) =>
      new Promise((resolve) => setTimeout(() => resolve(deliver(cb, serial)), 7000));
  }`);
  await page.goto(peer('alice'));
  const loading = page.locator('#loading');
  await expect(page.locator('#editor')).toBeHidden();
  await page.waitForTimeout(2000);
  await expect(loading, 'no bar on a short wait').toBeHidden();
  await expect(loading).toBeVisible({ timeout: 4000 });
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 5000 });
  await expect(loading).toBeHidden();
});

test('a read-mode tap right before closing is kept, and tells the chat nothing', async ({ page, isMobile }) => {
  // #59 review: the choice is debounced, so closing inside the debounce has to
  // send it. Reloading right after the tap is that close.
  await open(page);
  await press(page.getByTitle('Toggle read / edit mode'), isMobile);
  await page.reload();
  await expect(page.locator('.cm-editor')).toBeVisible();
  await expect(editor(page)).toHaveAttribute('contenteditable', 'false');
  // One update from alice, with no info line and no summary.
  expect(await chat(page)).toEqual(['alice']);
});

test('a desktop close sends a read-mode choice still in its debounce', async ({ page, isMobile }) => {
  // #59 review: desktop closes through beforeunload, with no visibilitychange.
  // Fired on its own here, well inside the 1 s debounce.
  await open(page);
  await press(page.getByTitle('Toggle read / edit mode'), isMobile);
  const log = await page.evaluate((key) => {
    window.dispatchEvent(new Event('beforeunload'));
    return localStorage.getItem(key);
  }, UPDATES_KEY);
  expect(log).toContain('"readMode"');
});

test('a replay that never settles shows the page after 10 s, in the stored read mode', async ({ page, context }) => {
  // #59 review: the wait for the replay is capped, for the page and for read
  // mode alike. This messenger delivers the log but never settles its promise.
  await serveMockWebxdc(context, `{
    const deliver = window.webxdc.setUpdateListener;
    window.webxdc.setUpdateListener = (cb, serial) => {
      deliver(cb, serial);
      return new Promise(() => {});
    };
  }`);
  await context.addInitScript(([key, update]) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify([update]));
  }, [UPDATES_KEY, {
    payload: { readMode: { addr: 'alice@local.host', on: true, n: 1, dev: 'seed' } },
    serial: 1,
    _sender: 'alice@local.host',
  }] as const);
  await page.goto(peer('alice'));
  await expect(page.locator('#loading')).toBeVisible({ timeout: 6000 });
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10_000 });
  await expect(editor(page)).toHaveAttribute('contenteditable', 'false');
});

test('a read-mode choice whose send was lost goes out on the next open, once', async ({ page, context, isMobile }) => {
  // #59 review: iOS can freeze the page before an async send lands. This
  // messenger drops read-mode sends while the tab is flagged.
  await serveMockWebxdc(context, `{
    const send = window.webxdc.sendUpdate;
    window.webxdc.sendUpdate = (u, d) => {
      if (u.payload.readMode && sessionStorage.getItem('drop-read-mode')) return;
      return send(u, d);
    };
  }`);
  await open(page);
  await page.evaluate(() => sessionStorage.setItem('drop-read-mode', '1'));
  await press(page.getByTitle('Toggle read / edit mode'), isMobile);
  await page.waitForTimeout(1500); // the debounce runs out; the send is dropped
  expect(await chat(page)).toEqual([]);

  await page.evaluate(() => sessionStorage.removeItem('drop-read-mode'));
  await page.reload();
  await expect(editor(page)).toHaveAttribute('contenteditable', 'false');
  expect(await chat(page)).toEqual(['alice']);

  await page.reload(); // the log has it now: nothing more goes out
  await expect(editor(page)).toHaveAttribute('contenteditable', 'false');
  expect(await chat(page)).toEqual(['alice']);
});

test('a read-mode switch reaches the same user’s other device, and no one else', async ({ page, context, isMobile }) => {
  // The feature's headline, end to end: two pages as alice are two of her
  // devices; bob is someone else in the chat.
  await open(page);
  const laptop = await context.newPage();
  await open(laptop, 'alice');
  const bob = await context.newPage();
  await open(bob, 'bob');
  const toggle = (p: typeof page) => press(p.getByTitle('Toggle read / edit mode'), isMobile);

  await toggle(page);
  await expect(editor(laptop)).toHaveAttribute('contenteditable', 'false');
  await expect(editor(bob)).toHaveAttribute('contenteditable', 'true');

  await toggle(laptop);
  await expect(editor(page)).toHaveAttribute('contenteditable', 'true');
  // Two silent updates from alice, nothing from bob, no info lines.
  expect(await chat(page)).toEqual(['alice', 'alice']);
});

test('Ctrl+Z in read mode changes nothing and publishes nothing', async ({ page, isMobile }) => {
  // Found in the #59 edge-case run (and present since read mode shipped): the
  // browser's own undo reached y-codemirror, which undid the session's edits.
  await open(page);
  await write(page, 'hello');
  await page.reload(); // publish the edit, so anything later would show
  await write(page, ' world');
  await press(page.getByTitle('Toggle read / edit mode'), isMobile);
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(300);
  await expect(editor(page)).toContainText('hello world');
  await page.reload(); // what was published is what peers get
  await expect(editor(page)).toContainText('hello world');
});

