import type { Locator, Page } from '@playwright/test';
import { test, expect, peer, press, serveMockWebxdc, chat, editor, open, write, REALTIME_UP, realtimeUp } from './fixtures';

// The device draft (src/collab.ts) can hold edits the chat never got: our own,
// when a send was lost, and other people's, which reach us over realtime
// before their author's send reaches the chat, or instead of it. On the next
// start both go out again. Ours go out as our edit, with the chat's info line
// and summary; other people's go out quietly, claiming nothing.
//
// A page opened at `losing(name)` drops every chat send it makes, the way iOS
// suspends the app before the messenger has its send (the loss the draft is
// there for). Its realtime frames still go out.

const LOSE_SENDS = 'if (new URLSearchParams(location.search).has("lose")) window.webxdc.sendUpdate = () => {};';
const losing = (name: string): string => `/?lose${peer(name).slice(1)}`;

test.beforeEach(async ({ context }) => {
  await serveMockWebxdc(context, REALTIME_UP + LOSE_SENDS);
});

const ownIds = (page: Page): Promise<string | null> =>
  page.evaluate(() => localStorage.getItem('md-docs-own-clients'));

/** Close `page` and start it again (at `url`, if given), waiting until the new
 *  session has restored its draft: the restore lists the session's client ID,
 *  which is new on every start. */
async function reopen(page: Page, url?: string): Promise<void> {
  const before = await ownIds(page);
  if (url) await page.goto(url);
  else await page.reload();
  await expect.poll(() => ownIds(page)).not.toBe(before);
}

/** Who each version in the history panel is credited to, newest first. */
async function credits(page: Page, isMobile: boolean): Promise<Locator> {
  const more = page.getByRole('button', { name: 'More' });
  if (await more.isVisible()) await press(more, isMobile);
  await press(page.getByRole('button', { name: 'Document history' }), isMobile);
  return page.locator('.hist-row .hist-who');
}

async function typeAtEnd(page: Page, text: string): Promise<void> {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText(text);
}

test("a watcher who reopens before the author's edit lands passes it on without claiming it", async ({ page, context, isMobile }) => {
  await open(page);
  const bob = await context.newPage();
  await open(bob, 'bob');
  await realtimeUp(bob);
  await write(page, 'from alice');
  await expect(editor(bob)).toContainText('from alice');

  await reopen(bob);
  expect(await chat(page)).toEqual(['bob re-sent']);

  // Alice's own send lands after it, and is the only claim; bob's next close
  // has nothing queued. The timeline credits her, not the peer that passed
  // her edit on.
  await page.reload();
  await bob.reload();
  expect(await chat(page)).toEqual(['bob re-sent', 'alice info summary']);
  await expect(await credits(page, isMobile)).toHaveText(['alice']);
});

test("edits whose author's send was lost reach the chat through a watcher, who retries a lost re-send", async ({ page, context, isMobile }) => {
  await open(page, 'alice', losing('alice'));
  const bob = await context.newPage();
  await open(bob, 'bob', losing('bob'));
  await realtimeUp(bob);
  await write(page, 'only alice had this');
  await expect(editor(bob)).toContainText('only alice had this');
  await page.close(); // and never comes back

  await reopen(bob); // still losing sends: the re-send is lost as well
  expect(await chat(bob)).toEqual([]);
  await reopen(bob, peer('bob'));
  expect(await chat(bob)).toEqual(['bob re-sent']);

  const carol = await context.newPage();
  await open(carol, 'carol');
  await expect(editor(carol)).toContainText('only alice had this');
  // Nobody knows whose it is any more; the timeline says who passed it on.
  await expect(await credits(carol, isMobile)).toHaveText(['re-sent by bob']);
});

test("a watcher's own edit on top of a lost one reaches others once the watcher reopens", async ({ page, context }) => {
  await open(page, 'alice', losing('alice'));
  const bob = await context.newPage();
  await open(bob, 'bob');
  await realtimeUp(bob);
  await write(page, 'hello');
  await expect(editor(bob)).toContainText('hello');
  await page.close();
  await typeAtEnd(bob, ' world');
  await bob.goto('about:blank'); // bob's close sends his edit, which builds on alice's

  // Carol has bob's edit but not the text it builds on, so she can't show it.
  const carol = await context.newPage();
  await open(carol, 'carol');
  expect(await chat(carol)).toEqual(['bob info summary']);
  await expect(editor(carol)).not.toContainText('world');

  await bob.goto(peer('bob'));
  await expect(editor(carol)).toHaveText('hello world');
  expect(await chat(carol)).toEqual(['bob info summary', 'bob re-sent']);
});

test('our own edits whose send was lost go out again under our name', async ({ page, context }) => {
  await open(page, 'bob', losing('bob'));
  await write(page, 'mine');
  await reopen(page, peer('bob'));
  await page.reload(); // the close sends what the reopen queued
  expect(await chat(page)).toEqual(['bob info summary']);

  const carol = await context.newPage();
  await open(carol, 'carol');
  await expect(editor(carol)).toHaveText('mine');
});

test('our own edits stay ours through a second lost send, and the ID list shrinks once they land', async ({ page }) => {
  await open(page, 'bob', losing('bob'));
  await write(page, 'one');
  await reopen(page); // queued again under our name, and lost again
  await reopen(page, peer('bob'));
  await page.reload();
  expect(await chat(page)).toEqual(['bob info summary']);

  // Once the edits are in the chat, only the running session stays listed.
  await reopen(page);
  expect(JSON.parse((await ownIds(page))!)).toHaveLength(1);
});

test("our lost edits mixed with someone else's unsent ones go out once, as ours", async ({ page, context }) => {
  await open(page);
  const bob = await context.newPage();
  await open(bob, 'bob', losing('bob'));
  await realtimeUp(bob);
  await write(page, 'alice');
  await expect(editor(bob)).toContainText('alice');
  await typeAtEnd(bob, ' and bob');

  await reopen(bob, peer('bob'));
  await bob.reload();
  // Alice's own autosave may land meanwhile; bob's part is one claim.
  expect((await chat(bob)).filter((u) => u.startsWith('bob'))).toEqual(['bob info summary']);
  const carol = await context.newPage();
  await open(carol, 'carol');
  await expect(editor(carol)).toHaveText('alice and bob');
});

test("a watcher who reopens after the author's edit landed sends nothing", async ({ page, context }) => {
  await open(page);
  const bob = await context.newPage();
  await open(bob, 'bob');
  await realtimeUp(bob);
  await write(page, 'from alice');
  await expect(editor(bob)).toContainText('from alice');
  await page.reload();

  await reopen(bob);
  expect(await chat(page)).toEqual(['alice info summary']);
});

test('a draft saved by the previous version still sends our lost edits under our name', async ({ page }) => {
  await open(page, 'bob', losing('bob'));
  await write(page, 'from the old version');
  // That version kept no list of its client IDs.
  await page.evaluate(() => localStorage.removeItem('md-docs-own-clients'));
  await reopen(page, peer('bob'));
  await page.reload();
  expect(await chat(page)).toEqual(['bob info summary']);
});

test('a lost deletion still reaches the chat', async ({ page, context }) => {
  // A deletion names no client ID to call ours, so it goes out quietly.
  await open(page, 'bob');
  await write(page, 'abc');
  await page.reload();
  await page.goto(losing('bob'));
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Backspace');
  await expect(editor(page)).toHaveText('ab');

  await reopen(page, peer('bob'));
  expect(await chat(page)).toEqual(['bob info summary', 'bob re-sent']);
  const carol = await context.newPage();
  await open(carol, 'carol');
  await expect(editor(carol)).toHaveText('ab');
});
