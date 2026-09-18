import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Y from 'yjs';
import { setupHistory } from './history.ts';

test('history reconstructs versions, dedups no-ops, and counts char changes', () => {
  // Build one updateV2 blob per transaction (a transaction ≈ one webxdc batch).
  const src = new Y.Doc();
  const text = src.getText('codemirror');
  const updates: Uint8Array[] = [];
  src.on('updateV2', (u: Uint8Array) => updates.push(u));
  src.transact(() => text.insert(0, 'hello'));                       // -> "hello"
  src.transact(() => text.insert(5, ' world'));                      // -> "hello world"
  src.transact(() => { text.insert(11, 'X'); text.delete(11, 1); }); // no-op net
  src.transact(() => text.delete(5, 6));                             // -> "hello"
  assert.equal(updates.length, 4, 'four batches captured');

  const b64 = (u: Uint8Array): string => Buffer.from(u).toString('base64');

  // Fake webxdc: capture the wrapped listener + outgoing sends.
  let listener: ((u: { payload: Record<string, unknown> }) => void) | undefined;
  const sent: Array<{ payload: Record<string, unknown> }> = [];
  const real = {
    selfName: 'Alice',
    setUpdateListener: (cb: (u: { payload: Record<string, unknown> }) => void) => {
      listener = cb;
      return Promise.resolve();
    },
    sendUpdate: (u: { payload: Record<string, unknown> }) => { sent.push(u); },
  } as unknown as typeof window.webxdc;

  const history = setupHistory(real);

  // The provider registers its listener through the shim...
  history.webxdc.setUpdateListener(() => {});
  assert.ok(listener, 'listener registered through shim');

  // ...then the channel replays the stored update stream (incl. offline edits).
  const authors = ['Alice', 'Bob', 'Bob', 'Carol'];
  updates.forEach((u, i) => {
    listener!({ payload: { serializedYjsUpdate: b64(u), t: (i + 1) * 1000, author: authors[i] } });
  });

  const v = history.versions();
  // The no-op third batch is dropped; the other three remain.
  assert.deepEqual(v.map((e) => e.text), ['hello', 'hello world', 'hello'], 'texts reconstructed');
  assert.deepEqual(v.map((e) => e.author), ['Alice', 'Bob', 'Carol'], 'authors, no-op dropped');
  assert.deepEqual(v.map((e) => e.t), [1000, 2000, 4000], 'timestamps, no-op dropped');
  assert.deepEqual(v.map((e) => e.added), [5, 6, 0], 'chars added');
  assert.deepEqual(v.map((e) => e.removed), [0, 0, 6], 'chars removed');

  // Outgoing sends get stamped with author + a timestamp so the metadata travels.
  history.webxdc.sendUpdate({ payload: { serializedYjsUpdate: 'x' } } as never, '');
  assert.equal(sent.length, 1, 'send delegated to real webxdc');
  assert.equal(sent[0].payload.author, 'Alice', 'author injected on send');
  assert.equal(typeof sent[0].payload.t, 'number', 'timestamp injected on send');

  // markRestore tags exactly the next outgoing batch (one-shot).
  history.markRestore({ t: 1000, author: 'Alice' });
  history.webxdc.sendUpdate({ payload: { serializedYjsUpdate: 'y' } } as never, '');
  history.webxdc.sendUpdate({ payload: { serializedYjsUpdate: 'z' } } as never, '');
  assert.deepEqual(sent[1].payload.restoredFrom, { t: 1000, author: 'Alice' }, 'restore tag injected');
  assert.equal(sent[2].payload.restoredFrom, undefined, 'restore tag is one-shot');

  // An incoming restore batch surfaces its source in versions().
  src.transact(() => text.insert(5, '!')); // "hello" -> "hello!"
  listener!({ payload: {
    serializedYjsUpdate: b64(updates[4]), t: 5000, author: 'Alice',
    restoredFrom: { t: 1000, author: 'Alice' },
  } });
  const after = history.versions();
  const last = after[after.length - 1];
  assert.equal(last.text, 'hello!', 'restore batch reconstructed');
  assert.deepEqual(last.restoredFrom, { t: 1000, author: 'Alice' }, 'restoredFrom surfaced');
});

test('shim works over a real-client webxdc (read-only, non-configurable methods)', () => {
  // The real Delta Chat webxdc exposes setUpdateListener/sendUpdate as
  // non-writable, non-configurable data properties. A Proxy that returns a
  // different value for them violates a Proxy invariant and throws on a real
  // device (the dev mock's props are configurable, so it never showed up here).
  // This reproduces that shape and asserts the shim wraps it without throwing.
  let listener: ((u: { payload: Record<string, unknown> }) => void) | undefined;
  const sent: Array<{ payload: Record<string, unknown> }> = [];
  const real = {} as unknown as typeof window.webxdc;
  const lock = { writable: false, configurable: false, enumerable: true };
  Object.defineProperties(real, {
    selfName: { ...lock, value: 'Alice' },
    setUpdateListener: { ...lock, value: (cb: typeof listener) => { listener = cb; } },
    sendUpdate: { ...lock, value: (u: { payload: Record<string, unknown> }) => { sent.push(u); } },
  });
  Object.freeze(real);

  const history = setupHistory(real);
  // Reading + calling the overridden methods through the shim must not throw.
  history.webxdc.setUpdateListener(() => {});
  assert.ok(listener, 'listener registered through shim over a frozen webxdc');
  history.webxdc.sendUpdate({ payload: { serializedYjsUpdate: 'x' } } as never, '');
  assert.equal(sent[0].payload.author, 'Alice', 'author injected, delegated to frozen real');
});

// --- Robustness against the wire -------------------------------------------
// Records come off the webxdc channel, so a batch may be truncated or written
// by a different app/version sharing it. versions() is re-run on every update
// and on every render, so one bad record must not become permanent damage.

// Minimal fake webxdc, plus a `fire` that feeds one batch through the shim.
interface Fake {
  real: typeof window.webxdc;
  fire: (payload: Record<string, unknown>) => void;
}

function fakeWebxdc(): Fake {
  let listener: ((u: { payload: Record<string, unknown> }) => void) | undefined;
  const real = {
    selfName: 'Alice',
    setUpdateListener: (cb: (u: { payload: Record<string, unknown> }) => void) => {
      listener = cb;
      return Promise.resolve();
    },
    sendUpdate: () => {},
  } as unknown as typeof window.webxdc;
  return { real, fire: (payload) => listener!({ payload }) };
}

// One updateV2 blob per transaction, base64 as the provider serializes it.
function blobs(edits: Array<(t: Y.Text) => void>): string[] {
  const doc = new Y.Doc();
  const out: string[] = [];
  doc.on('updateV2', (u: Uint8Array) => out.push(Buffer.from(u).toString('base64')));
  for (const edit of edits) doc.transact(() => edit(doc.getText('codemirror')));
  return out;
}

test('a batch that cannot be decoded is skipped, not fatal for the timeline', () => {
  const [first, second] = blobs([
    (t) => t.insert(0, 'hello'),
    (t) => t.insert(5, ' world'),
  ]);
  const { real, fire } = fakeWebxdc();
  const history = setupHistory(real);
  history.webxdc.setUpdateListener(() => {});

  fire({ serializedYjsUpdate: first, t: 1, author: 'Alice' });
  fire({ serializedYjsUpdate: 'not!!valid!!base64', t: 2, author: 'Mallory' }); // atob throws
  fire({ serializedYjsUpdate: Buffer.from([9, 9, 9, 9]).toString('base64'), t: 3 }); // yjs throws
  fire({ serializedYjsUpdate: second, t: 4, author: 'Bob' });

  const v = history.versions();
  assert.deepEqual(v.map((e) => e.text), ['hello', 'hello world'], 'good batches survive');
  assert.deepEqual(v.map((e) => e.author), ['Alice', 'Bob'], 'bad batches dropped');
});

test('a throwing onChange listener is contained and the rest still run', () => {
  // The history overlay renders from onChange. Notifying before handing the
  // update to the provider meant a render error swallowed the update entirely,
  // so the shared document stopped syncing until the app was restarted. The
  // provider now goes first, AND a failing listener no longer escapes into the
  // webxdc host's dispatch loop or skips the listeners queued behind it.
  const [blob] = blobs([(t) => t.insert(0, 'hi')]);
  const { real, fire } = fakeWebxdc();
  const history = setupHistory(real);
  const received: unknown[] = [];
  history.webxdc.setUpdateListener((u) => { received.push(u); });
  let reachedSecond = false;
  history.onChange(() => { throw new Error('render blew up'); });
  history.onChange(() => { reachedSecond = true; });

  assert.doesNotThrow(() => fire({ serializedYjsUpdate: blob, t: 1, author: 'Alice' }));
  assert.equal(received.length, 1, 'the provider still got the update');
  assert.equal(reachedSecond, true, 'a later listener is not skipped by the failing one');
  assert.deepEqual(history.versions().map((e) => e.text), ['hi'], 'and it was recorded');
});

test('metadata missing from a peer batch falls back instead of showing undefined', () => {
  const [blob] = blobs([(t) => t.insert(0, 'hi')]);
  const { real, fire } = fakeWebxdc();
  const history = setupHistory(real);
  history.webxdc.setUpdateListener(() => {});
  const before = Date.now();
  fire({ serializedYjsUpdate: blob }); // a batch from a version that stamped nothing

  const [v] = history.versions();
  assert.equal(v.author, 'unknown');
  assert.ok(v.t >= before, 'timestamped on receipt');
});

test('a non-Yjs payload on the same channel is ignored outright', () => {
  const { real, fire } = fakeWebxdc();
  const history = setupHistory(real);
  history.webxdc.setUpdateListener(() => {});
  fire({ hello: 'world' });
  fire({ serializedYjsUpdate: 42 }); // wrong type
  assert.deepEqual(history.versions(), []);
});

test('replayed() resolves on a client whose setUpdateListener returns void', () => {
  // The webxdc spec has it return a promise, but not every implementation does;
  // the draft restore is gated on this and must not hang.
  const real = {
    selfName: 'Alice',
    setUpdateListener: () => undefined,
    sendUpdate: () => {},
  } as unknown as typeof window.webxdc;
  const history = setupHistory(real);
  history.webxdc.setUpdateListener(() => {});
  return history.replayed(); // node:test fails the test if this never settles
});

test('selfName missing (a client that does not expose it) stamps "unknown"', () => {
  const sent: Array<{ payload: Record<string, unknown> }> = [];
  const real = {
    setUpdateListener: () => Promise.resolve(),
    sendUpdate: (u: { payload: Record<string, unknown> }) => { sent.push(u); },
  } as unknown as typeof window.webxdc;
  setupHistory(real).webxdc.sendUpdate({ payload: {} } as never, '');
  assert.equal(sent[0].payload.author, 'unknown');
});
