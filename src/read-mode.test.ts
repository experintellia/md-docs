import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createReadModePref, type ReadModeLink } from './read-mode.ts';
import { createChatLog } from './test-chat-log.ts';

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ALICE = 'alice@example.com';
type Payload = Record<string, unknown>;
const choice = (p: Payload | undefined): { on: boolean; n: number; dev: string } =>
  p?.readMode as { on: boolean; n: number; dev: string };

/** A link the test drives by hand: what it hears, in what order, and when the
 *  replay ends. Sends are only recorded. */
function manualLink(me = ALICE, unsent?: ReadModeLink['unsent']): {
  link: ReadModeLink;
  sent: Payload[];
  deliver(p: Payload): void;
  finishReplay(): void;
} {
  const sent: Payload[] = [];
  let listener: (p: Payload) => void = () => {};
  let finish: () => void = () => {};
  const link: ReadModeLink = {
    me,
    send: (p) => { sent.push(p); },
    onMessage: (cb) => { listener = cb; },
    replayed: new Promise<void>((r) => { finish = r; }),
    unsent,
  };
  return { link, sent, deliver: (p) => listener(p), finishReplay: () => finish() };
}

test('a choice is sent once, when the taps stop, as a silent update for this viewer', async () => {
  const chat = createChatLog();
  const phone = createReadModePref(chat.link(ALICE), 10);
  await tick();
  phone.set(true);
  phone.set(false);
  phone.set(true);
  assert.equal(chat.stored.length, 0, 'nothing sent while the taps continue');
  await tick(30);
  assert.equal(chat.stored.length, 1, 'one update');
  const sent = choice(chat.stored[0]);
  assert.equal((chat.stored[0]!.readMode as { addr: string }).addr, ALICE);
  assert.equal(sent.on, true, 'only the last value');
  assert.equal(sent.n, 1);
  assert.equal(typeof sent.dev, 'string');
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
  assert.equal(laptop.get(), true, 'the newest stored choice');
  assert.equal(changes, 1, 'applied once, not once per stored update');
});

test('an update arriving while the replay is still running waits for it', async () => {
  const m = manualLink();
  const laptop = createReadModePref(m.link, 10);
  let changes = 0;
  laptop.onChange(() => { changes++; });
  m.deliver({ readMode: { addr: ALICE, on: true, n: 1, dev: 'phone' } });
  await tick();
  assert.equal(laptop.get(), false, 'not applied mid-replay');
  m.finishReplay();
  await tick();
  assert.equal(laptop.get(), true);
  assert.equal(changes, 1);
});

test('other viewers and malformed updates never set this viewer’s choice', async () => {
  const chat = createChatLog();
  const bob = createReadModePref(chat.link('bob@example.com'), 10);
  await tick();
  bob.set(true);
  await tick(30);
  chat.link(ALICE).send({ readMode: 'yes' });
  chat.link(ALICE).send({ readMode: { addr: ALICE, on: 'yes', n: 5, dev: 'x' } });
  chat.link(ALICE).send({ readMode: { addr: ALICE, on: true } }); // no counter
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
  chat.link(ALICE).send({ readMode: { addr: ALICE, on: true, n: 99, dev: 'tablet' } });
  assert.equal(laptop.get(), false, 'the pending tap is not overwritten');

  // When the debounce runs out the tap is sent, ranked above everything the
  // laptop has seen, and the phone, a live device, follows it.
  await tick(250);
  const last = choice(chat.stored[chat.stored.length - 1]);
  assert.equal(last.on, false);
  assert.equal(last.n, 100, 'one above the highest counter seen');
  assert.equal(laptop.get(), false);
  assert.equal(phone.get(), false, 'the phone shows the laptop’s choice');
});

test('devices that saw the same updates in different orders agree', async () => {
  // The phone is offline and taps read. The laptop taps read, then edit. Each
  // stores its own sends first and the other's later, so their logs differ.
  const phone = manualLink();
  const laptop = manualLink();
  const phonePref = createReadModePref(phone.link, 0);
  const laptopPref = createReadModePref(laptop.link, 0);
  phone.finishReplay();
  laptop.finishReplay();
  await tick();
  phonePref.set(true);
  phonePref.flush();
  laptopPref.set(true);
  laptopPref.flush();
  laptopPref.set(false);
  laptopPref.flush();

  // Online again: each hears the other's sends, after its own.
  for (const p of laptop.sent) phone.deliver(p);
  for (const p of phone.sent) laptop.deliver(p);
  assert.equal(phonePref.get(), false, 'the phone takes the laptop’s later edit');
  assert.equal(laptopPref.get(), false, 'the laptop keeps it');

  // A relaunch replays each device's own log, in its own order.
  for (const log of [[...phone.sent, ...laptop.sent], [...laptop.sent, ...phone.sent]]) {
    const fresh = manualLink();
    const pref = createReadModePref(fresh.link, 0);
    for (const p of log) fresh.deliver(p);
    fresh.finishReplay();
    await tick();
    assert.equal(pref.get(), false, 'same choice whatever the order');
  }
});

test('two choices made without seeing each other settle the same way everywhere', async () => {
  const a = { readMode: { addr: ALICE, on: true, n: 1, dev: 'aaa' } };
  const b = { readMode: { addr: ALICE, on: false, n: 1, dev: 'bbb' } };
  const results: boolean[] = [];
  for (const log of [[a, b], [b, a]]) {
    const m = manualLink();
    const pref = createReadModePref(m.link, 0);
    for (const p of log) m.deliver(p);
    m.finishReplay();
    await tick();
    results.push(pref.get());
  }
  assert.equal(results[0], results[1]);
});

test('flush sends a pending choice at once', () => {
  const chat = createChatLog();
  const phone = createReadModePref(chat.link(ALICE), 60_000);
  phone.set(true);
  assert.equal(chat.stored.length, 0);
  phone.flush();
  assert.equal(chat.stored.length, 1);
  assert.equal(choice(chat.stored[0]).on, true);
  phone.flush();
  assert.equal(chat.stored.length, 1, 'nothing left to send');
});

/** Stand-in for the device's localStorage slot, surviving a "relaunch". */
function memoryStore(): NonNullable<ReadModeLink['unsent']> & { value: unknown } {
  const store = {
    value: null as unknown,
    load: () => store.value,
    save: (p: Payload | null) => { store.value = p; },
  };
  return store;
}

test('a choice whose send never reached the log goes out again after the next replay', async () => {
  // iOS can freeze the page before an async send reaches the messenger.
  const store = memoryStore();
  const before = manualLink(ALICE, store);
  const phone = createReadModePref(before.link, 10);
  before.finishReplay();
  await tick();
  phone.set(true);
  phone.flush();
  assert.equal(before.sent.length, 1, 'sent, but it never lands: nothing is delivered back');
  assert.deepEqual(store.value, before.sent[0], 'kept on the device meanwhile');

  // Relaunch: the log replays without it.
  const after = manualLink(ALICE, store);
  const relaunched = createReadModePref(after.link, 10);
  after.finishReplay();
  await tick();
  assert.deepEqual(after.sent, [before.sent[0]], 'sent again, unchanged');
  assert.equal(relaunched.get(), true, 'and shown');

  // Its echo clears the slot; the next launch sends nothing.
  after.deliver(after.sent[0]!);
  assert.equal(store.value, null);
});

test('a kept choice already in the log, or outranked, is not sent again', async () => {
  for (const [label, log, shows] of [
    ['landed', (p: Payload) => [p], true],
    ['outranked', () => [{ readMode: { addr: ALICE, on: false, n: 7, dev: 'laptop' } }], false],
  ] as const) {
    const store = memoryStore();
    const first = manualLink(ALICE, store);
    const phone = createReadModePref(first.link, 10);
    first.finishReplay();
    await tick();
    phone.set(true);
    phone.flush();

    const next = manualLink(ALICE, store);
    const pref = createReadModePref(next.link, 10);
    for (const p of log(first.sent[0]!)) next.deliver(p);
    next.finishReplay();
    await tick();
    assert.deepEqual(next.sent, [], `${label}: nothing resent`);
    assert.equal(store.value, null, `${label}: slot cleared`);
    assert.equal(pref.get(), shows, `${label}: shows the log's choice`);
  }
});

test('a corrupt kept slot is dropped', async () => {
  const store = memoryStore();
  store.value = { readMode: 'garbage' };
  const m = manualLink(ALICE, store);
  const pref = createReadModePref(m.link, 10);
  m.finishReplay();
  await tick();
  assert.equal(store.value, null);
  assert.deepEqual(m.sent, []);
  assert.equal(pref.get(), false);
});

test('a counter that is not a safe positive integer is refused', async () => {
  // At 2^53 or Infinity, n + 1 === n: every later tap would tie with it.
  const m = manualLink();
  const pref = createReadModePref(m.link, 0);
  for (const n of [Infinity, 2 ** 53, 0, -1, 1.5, NaN]) {
    m.deliver({ readMode: { addr: ALICE, on: true, n, dev: 'peer' } });
  }
  m.finishReplay();
  await tick();
  assert.equal(pref.get(), false, 'none of them applied');
  pref.set(true);
  pref.flush();
  assert.equal(choice(m.sent[0]).n, 1, 'the counter was not advanced by them');
});
