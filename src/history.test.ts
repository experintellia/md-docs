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
});
