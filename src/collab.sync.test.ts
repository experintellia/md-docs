import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Y from 'yjs';
import { fromUint8Array, toUint8Array } from 'js-base64';

// Tier 3: the CRDT guarantees the app's collaboration relies on. These bind the
// same Y.Text key the editor uses, so a wiring regression (or a bad yjs bump)
// surfaces here, headless — no webxdc, no DOM.

const KEY = 'codemirror'; // must match ydoc.getText(...) in createCollab()

// Exchange state both ways, like the realtime channel's late-joiner catch-up.
function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

test('concurrent edits on two peers converge', () => {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.getText(KEY).insert(0, 'hello world');
  sync(a, b);

  // Concurrent, with no sync in between.
  a.getText(KEY).insert(0, 'A: ');
  b.getText(KEY).insert(b.getText(KEY).length, ' (B)');
  sync(a, b);

  assert.equal(a.getText(KEY).toString(), b.getText(KEY).toString());
  assert.match(a.getText(KEY).toString(), /A: /);
  assert.match(a.getText(KEY).toString(), /\(B\)/);
});

test('a late joiner sees the existing document — the seed invariant', () => {
  // Regression guard for the second-device crash: main.ts seeds CodeMirror from
  // ytext.toString() because the provider has already replayed peer updates into
  // ytext by mount time. So after applying a peer's update, ytext must already
  // hold the whole document — seeding CM with '' (the old bug) desynced them.
  const existing = new Y.Doc();
  existing.getText(KEY).insert(0, '# Notes\n\n- [x] ship it');

  const joiner = new Y.Doc();
  Y.applyUpdate(joiner, Y.encodeStateAsUpdate(existing));

  const seed = joiner.getText(KEY).toString();
  assert.equal(seed, '# Notes\n\n- [x] ship it');
  assert.notEqual(seed, '');
});

test('the localStorage crash-net round-trips edits and is a no-op once synced', () => {
  // createCollab() mirrors the doc to localStorage as base64 of
  // encodeStateAsUpdateV2, then re-applies it on the next startup. Guards that
  // exact path: a draft saved before an iOS suspend is restored, and restoring
  // when the same edits already arrived via the channel adds nothing back.
  const edited = new Y.Doc();
  edited.getText(KEY).insert(0, '# draft never flushed');
  const draft = fromUint8Array(Y.encodeStateAsUpdateV2(edited)); // what we store

  // Cold start with an empty channel: the draft is fully restored.
  const restored = new Y.Doc();
  Y.applyUpdateV2(restored, toUint8Array(draft));
  assert.equal(restored.getText(KEY).toString(), '# draft never flushed');

  // Cold start where the channel already replayed those edits: re-applying the
  // draft fires no update (no double-up, nothing re-queued to peers).
  const synced = new Y.Doc();
  Y.applyUpdateV2(synced, Y.encodeStateAsUpdateV2(edited));
  let fired = false;
  synced.on('updateV2', () => { fired = true; });
  Y.applyUpdateV2(synced, toUint8Array(draft));
  assert.equal(synced.getText(KEY).toString(), '# draft never flushed');
  assert.equal(fired, false);
});

test('applying the same update twice is idempotent', () => {
  // The doc rides two channels (persistent + realtime); the same update can
  // arrive on both. Yjs must dedupe, or the text would double up.
  const src = new Y.Doc();
  src.getText(KEY).insert(0, 'xyz');
  const update = Y.encodeStateAsUpdate(src);

  const dst = new Y.Doc();
  Y.applyUpdate(dst, update);
  Y.applyUpdate(dst, update);
  assert.equal(dst.getText(KEY).toString(), 'xyz');
});
