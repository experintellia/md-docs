import type { Locator, Page } from '@playwright/test';
import { test, expect, peer, press, serveMockWebxdc, UPDATES_KEY } from './fixtures';

// Bugs the app has had, pinned where they lived: in the wiring between
// modules, in CSS, or in how a real engine behaves. Bugs in a single module's
// logic are pinned by the unit tests beside it (src/**/*.test.ts).

const editor = (page: Page): Locator => page.locator('#editor .cm-content');

const DRAFT_KEY = 'md-docs-draft'; // must match src/collab.ts

async function open(page: Page, name = 'alice'): Promise<void> {
  await page.goto(peer(name));
  await expect(page.locator('.cm-editor')).toBeVisible();
}

async function write(page: Page, text: string): Promise<void> {
  await editor(page).click();
  await page.keyboard.insertText(text);
}

// The mock connects realtime 500 ms after joinRealtimeChannel, and a frame sent
// before then is dropped. A second 500 ms timer fires after the mock's own.
const REALTIME_UP = `{
  const join = window.webxdc.joinRealtimeChannel;
  window.webxdc.joinRealtimeChannel = (...args) => {
    const channel = join(...args);
    setTimeout(() => (window.realtimeUp = true), 500);
    return channel;
  };
}`;
const realtimeUp = (page: Page): Promise<unknown> => page.waitForFunction(() => 'realtimeUp' in window);

/** Who has published to the chat so far, one entry per update. */
const senders = (page: Page): Promise<string[]> =>
  page.evaluate((key) => (JSON.parse(localStorage.getItem(key) ?? '[]') as { _sender: string }[])
    .map((update) => update._sender), UPDATES_KEY);

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
  const published = await senders(page);
  expect(published).toEqual(['alice@local.host']);

  // Twice: the second close flushes whatever the first reopen queued.
  await page.reload();
  await page.reload();
  await expect(editor(page)).toContainText('hello');
  expect(await senders(page)).toEqual(published);
});

test('watching someone else type publishes nothing', async ({ page, context }) => {
  // 0.1.11: every peer re-published what reached it over realtime, under its
  // own name, notifying the chat as if it had made the edit.
  await serveMockWebxdc(context, REALTIME_UP);
  await open(page);
  const bob = await context.newPage();
  await open(bob, 'bob');
  // First, bob's close does flush: an edit of his own goes out under his name.
  // Checked before alice types, while the draft both pages share here holds
  // nothing of hers that a reopen could re-queue.
  await write(bob, 'hi');
  await bob.reload();
  expect(await senders(page)).toEqual(['bob@local.host']);

  await realtimeUp(bob);
  await write(page, 'hello bob');
  await expect(editor(bob)).toContainText('hello bob');
  // Nothing new is published, so it came over realtime: the path under test.
  expect(await senders(page)).toEqual(['bob@local.host']);
  await bob.reload(); // closing flushes whatever bob queued
  expect(await senders(page)).toEqual(['bob@local.host']);
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
  // A new device has no draft; here it would read alice's, and show the text
  // without the chat log.
  await bob.addInitScript((key) => localStorage.removeItem(key), DRAFT_KEY);
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
      if (key === draftKey) throw new DOMException('full', 'QuotaExceededError');
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
