import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createReadModePref } from './read-mode.ts';
import { createChatLog } from './test-chat-log.ts';

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ALICE = 'alice@example.com';

test('a choice is sent once, when the taps stop, as a silent update for this viewer', async () => {
  const chat = createChatLog();
  const phone = createReadModePref(chat.link(ALICE), 10);
  await tick();
  phone.set(true);
  phone.set(false);
  phone.set(true);
  assert.equal(chat.stored.length, 0, 'nothing sent while the taps continue');
  await tick(30);
  assert.deepEqual(chat.stored, [{ readMode: { addr: ALICE, on: true } }], 'only the last value');
});

test('a choice equal to the stored one sends nothing', async () => {
  const chat = createChatLog();
  const phone = createReadModePref(chat.link(ALICE), 10);
  await tick();
  phone.set(true);
  await tick(30);
  const laptop = createReadModePref(chat.link(ALICE), 10);
  await tick();
  assert.equal(laptop.get(), true);
  laptop.set(false);
  laptop.set(true); // back where it was before the debounce ran out
  await tick(30);
  assert.equal(chat.stored.length, 1, 'no second update');
});

test('a device opens in the stored choice, applied once after the replay', async () => {
  const chat = createChatLog();
  const phone = createReadModePref(chat.link(ALICE), 10);
  await tick();
  for (const on of [true, false, true]) {
    phone.set(on);
    await tick(30);
  }
  assert.equal(chat.stored.length, 3);

  const laptop = createReadModePref(chat.link(ALICE), 10);
  let changes = 0;
  laptop.onChange(() => { changes++; });
  assert.equal(laptop.get(), false, 'nothing applied while the log replays');
  assert.equal(changes, 0);
  await tick();
  assert.equal(laptop.get(), true, 'the last stored choice');
  assert.equal(changes, 1, 'applied once, not once per stored update');
});

test('other viewers and malformed updates never set this viewer’s choice', async () => {
  const chat = createChatLog();
  const bob = createReadModePref(chat.link('bob@example.com'), 10);
  await tick();
  bob.set(true);
  await tick(30);
  chat.link(ALICE).send({ readMode: 'yes' });
  chat.link(ALICE).send({ readMode: { addr: ALICE, on: 'yes' } });
  const alice = createReadModePref(chat.link(ALICE), 10);
  await tick();
  assert.equal(alice.get(), false);
});

test('a change from another device shows live, unless a choice is still pending', async () => {
  const chat = createChatLog();
  const phone = createReadModePref(chat.link(ALICE), 10);
  const laptop = createReadModePref(chat.link(ALICE), 200);
  await tick();
  let laptopChanges = 0;
  laptop.onChange(() => { laptopChanges++; });

  phone.set(true);
  await tick(30);
  assert.equal(laptop.get(), true, 'the phone’s choice reaches the laptop live');
  assert.equal(laptopChanges, 1);

  // The laptop taps "edit" and its debounce is running. Meanwhile another
  // device's "read" update arrives: the tap stays on screen.
  laptop.set(false);
  chat.link(ALICE).send({ readMode: { addr: ALICE, on: true } });
  assert.equal(laptop.get(), false, 'the pending tap is not overwritten');

  // When the debounce runs out the tap is sent, as the newest choice, and the
  // phone, a live device, follows it.
  await tick(250);
  assert.equal((chat.stored[chat.stored.length - 1]!.readMode as { on: boolean }).on, false);
  assert.equal(laptop.get(), false);
  assert.equal(phone.get(), false, 'the phone shows the laptop’s choice');
});

test('flush sends a pending choice at once', () => {
  const chat = createChatLog();
  const phone = createReadModePref(chat.link(ALICE), 60_000);
  phone.set(true);
  assert.equal(chat.stored.length, 0);
  phone.flush();
  assert.deepEqual(chat.stored, [{ readMode: { addr: ALICE, on: true } }]);
  phone.flush();
  assert.equal(chat.stored.length, 1, 'nothing left to send');
});
