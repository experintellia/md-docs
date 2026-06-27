import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Y from 'yjs';
import { setupHistory } from './history.ts';

test('history reconstructs versions and metadata from the update stream', () => {
// Build two incremental updateV2 blobs from a real edit sequence.
  const src = new Y.Doc();
  const text = src.getText('codemirror');
  const updates: Uint8Array[] = [];
  src.on('updateV2', (u: Uint8Array) => updates.push(u));
  text.insert(0, 'hello');
  text.insert(5, ' world');
  assert.equal(updates.length, 2, 'two batches captured');

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
listener!({ payload: { serializedYjsUpdate: b64(updates[0]), t: 1000, author: 'Alice' } });
listener!({ payload: { serializedYjsUpdate: b64(updates[1]), t: 2000, author: 'Bob' } });

const list = history.list();
assert.deepEqual(list.map((e) => e.author), ['Alice', 'Bob'], 'authors in receipt order');
assert.deepEqual(list.map((e) => e.t), [1000, 2000], 'timestamps preserved');
assert.equal(history.textAt(0), 'hello', 'version 0 reconstructed');
assert.equal(history.textAt(1), 'hello world', 'version 1 reconstructed');

// Outgoing sends get stamped with author + a timestamp so the metadata travels.
history.webxdc.sendUpdate({ payload: { serializedYjsUpdate: 'x' } } as never, '');
assert.equal(sent.length, 1, 'send delegated to real webxdc');
assert.equal(sent[0].payload.author, 'Alice', 'author injected on send');
assert.equal(typeof sent[0].payload.t, 'number', 'timestamp injected on send');
});
