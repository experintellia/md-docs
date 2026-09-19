import { test, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as Y from 'yjs';
import { fromUint8Array } from 'js-base64';

GlobalRegistrator.register();
const { createCollab, titleFromMarkdown } = await import('./collab.ts');
after(() => GlobalRegistrator.unregister());

test('titleFromMarkdown reduces a markdown line to plaintext', () => {
  const cases: [string, string][] = [
    ['# My notes', 'My notes'],
    ['### **Draft** `v2`', 'Draft v2'],
    ['- [ ] buy milk', 'buy milk'],
    ['> a quote', 'a quote'],
    ['see [the docs](https://x.y) now', 'see the docs now'],
    ['*emphasis* and __strong__', 'emphasis and strong'],
    ['plain text', 'plain text'],
    // Edge cases: the first line is whatever the user happens to be typing, and
    // the result is the document title shown in the chat list.
    ['![screenshot](shot.png)', 'screenshot'], // image: the `!` is not the title
    ['# ', ''],                                // heading marker, nothing typed yet
    ['', ''],
    ['1. first item', 'first item'],           // ordered list marker
    ['***bold italic***', 'bold italic'],
    ['**unclosed bold', 'unclosed bold'],      // stray markers stripped
    ['# `code` **and** *more*', 'code and more'],
  ];
  for (const [input, want] of cases)
    assert.equal(titleFromMarkdown(input), want, `titleFromMarkdown(${JSON.stringify(input)})`);
});

// Regression guard for the spurious "updated the document" notification: the
// localStorage draft restore must wait for the channel replay, so a plain app
// open (draft fully synced) queues nothing, while a genuinely unsent tail
// still re-propagates — with the notification, since that IS a real edit.

const DRAFT_KEY = 'md-docs-draft'; // must match collab.ts
const KEY = 'codemirror';
interface Sent { payload: { serializedYjsUpdate: string }; info?: string }

// Minimal webxdc mock: setUpdateListener replays `stored` synchronously and
// resolves (like a real client after catch-up); sendUpdate is captured.
function mockWebxdc(stored: string[]): Sent[] {
  const sent: Sent[] = [];
  (window as unknown as { webxdc: unknown }).webxdc = {
    selfAddr: 'alice@example.com',
    selfName: 'Alice',
    sendUpdate: (u: Sent) => { sent.push(u); },
    setUpdateListener: (cb: (u: { payload: object }) => void) => {
      for (const b of stored) cb({ payload: { serializedYjsUpdate: b } });
      return Promise.resolve();
    },
  };
  return sent;
}

// Let history.replayed().then(applyDraft) run (a macrotask outlasts the chain).
const settle = (): Promise<void> => new Promise((r) => setTimeout(r));

test('a fully-synced draft neither queues nor notifies on plain open', async () => {
  const src = new Y.Doc();
  src.getText(KEY).insert(0, 'hello');
  const b64 = fromUint8Array(Y.encodeStateAsUpdateV2(src));
  localStorage.setItem(DRAFT_KEY, b64);
  const sent = mockWebxdc([b64]); // channel already replayed the same edits

  const collab = createCollab();
  await settle();
  collab.provider.syncToChatPeers();

  assert.equal(sent.length, 0, 'nothing queued → no send, no notification');
  assert.equal(collab.ytext.toString(), 'hello');
});

test('an unsent draft tail re-queues and sends exactly one notifying update', async () => {
  const src = new Y.Doc();
  src.getText(KEY).insert(0, 'hello');
  const storedB64 = fromUint8Array(Y.encodeStateAsUpdateV2(src));
  src.getText(KEY).insert(5, ' tail'); // never reached the channel
  localStorage.setItem(DRAFT_KEY, fromUint8Array(Y.encodeStateAsUpdateV2(src)));
  const sent = mockWebxdc([storedB64]);

  const collab = createCollab();
  await settle();
  collab.provider.syncToChatPeers();

  assert.equal(sent.length, 1);
  assert.ok(sent[0].info, 'the notification travels with the real edit');
  assert.equal(collab.ytext.toString(), 'hello tail');
  localStorage.removeItem(DRAFT_KEY);
});

test('an empty or marker-only first line still yields a title', () => {
  // getEditInfo() falls back to "Untitled" and clips at 60 chars; both matter
  // because this string is the document name every peer sees in their chat.
  assert.equal(titleFromMarkdown('#  ') || 'Untitled', 'Untitled');
  assert.equal((titleFromMarkdown('# ' + 'x'.repeat(200)) || 'Untitled').slice(0, 60).length, 60);
});

test('a draft that is not valid Yjs data is discarded, not fatal on startup', () => {
  // localStorage is shared with anything else on the origin and survives app
  // upgrades, so the stored blob can be garbage. It must not block the editor.
  localStorage.setItem(DRAFT_KEY, 'this is not base64 yjs data');
  mockWebxdc([]);

  const collab = createCollab();
  return settle().then(() => {
    assert.equal(collab.ytext.toString(), '', 'editor starts empty rather than throwing');
    assert.equal(localStorage.getItem(DRAFT_KEY), null, 'the corrupt draft is dropped');
  });
});

test('with no draft stored the editor starts from the channel replay alone', () => {
  localStorage.removeItem(DRAFT_KEY);
  const src = new Y.Doc();
  src.getText(KEY).insert(0, 'from peers');
  const sent = mockWebxdc([fromUint8Array(Y.encodeStateAsUpdateV2(src))]);

  const collab = createCollab();
  return settle().then(() => {
    collab.provider.syncToChatPeers();
    assert.equal(collab.ytext.toString(), 'from peers');
    assert.equal(sent.length, 0, 'a plain open queues nothing');
  });
});

// --- Draft save failures (issue #23) ---------------------------------------
// setItem throws QuotaExceededError once the origin budget is gone, and
// saveDraft runs from a visibilitychange handler and from a timer — both
// places where an uncaught throw goes nowhere and the crash net silently
// stops working, which is the exact failure it exists to prevent.

// Make selected localStorage methods throw, and return a restore function. The
// WHOLE accessor is replaced: happy-dom's localStorage is a Proxy, so assigning
// to `setItem` (on the instance or on Storage.prototype) is silently dropped
// and a test written that way passes without exercising anything.
function failStorage(
  fail: { getItem?: boolean; setItem?: boolean; removeItem?: boolean },
): () => void {
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
  const real = window.localStorage;
  const boom = (): never => {
    const err = new Error('QuotaExceededError');
    err.name = 'QuotaExceededError';
    throw err;
  };
  const stub = {
    getItem: (k: string) => (fail.getItem ? boom() : real.getItem(k)),
    setItem: (k: string, v: string) => (fail.setItem ? boom() : real.setItem(k, v)),
    removeItem: (k: string) => (fail.removeItem ? boom() : real.removeItem(k)),
    clear: () => real.clear(),
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, get: () => stub });
  return () => Object.defineProperty(window, 'localStorage', original);
}

// Background the app the way the real handler is driven.
function background(): void {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  window.dispatchEvent(new Event('visibilitychange'));
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
}

test('a draft save that exceeds quota is contained and reported', async () => {
  localStorage.removeItem(DRAFT_KEY);
  mockWebxdc([]);
  const saves: boolean[] = [];
  const collab = createCollab((ok) => saves.push(ok));
  await settle();
  collab.ytext.insert(0, 'some work worth keeping');

  background();
  assert.ok(localStorage.getItem(DRAFT_KEY), 'the draft was written while storage was healthy');
  assert.deepEqual(saves, [true]);

  const restore = failStorage({ setItem: true });
  try {
    collab.ytext.insert(0, 'more work');
    assert.doesNotThrow(background, 'the throw does not escape the visibilitychange handler');
    assert.deepEqual(saves, [true, false], 'the failure is reported as it happens');
  } finally {
    restore();
  }

  // Recovering clears it again, and the report is what drives the UI.
  background();
  assert.deepEqual(saves, [true, false, true]);
  localStorage.removeItem(DRAFT_KEY);
});

test('storage blocked outright does not stop the editor from starting', async () => {
  // Some engines throw on EVERY access, not just writes — including the
  // getItem that reads the draft during createCollab(). An earlier version of
  // this test only made setItem throw, so it asserted coverage it did not have
  // and passed while startup was still able to die here.
  localStorage.removeItem(DRAFT_KEY);
  mockWebxdc([]);
  const restore = failStorage({ getItem: true, setItem: true, removeItem: true });
  try {
    const saves: boolean[] = [];
    let collab: ReturnType<typeof createCollab> | undefined;
    assert.doesNotThrow(() => { collab = createCollab((ok) => saves.push(ok)); },
      'createCollab survives a store that throws on read');
    await settle();
    collab!.ytext.insert(0, 'typed anyway');
    assert.doesNotThrow(background);
    assert.equal(collab!.ytext.toString(), 'typed anyway', 'editing still works');
    assert.ok(saves.includes(false), 'and the broken net is reported');
  } finally {
    restore();
  }
});

test('a corrupt draft that cannot be removed still leaves saving enabled', async () => {
  // applyDraft drops an undecodable draft. If that removeItem throws, an
  // earlier version never reached `restored = true`, so every later save
  // early-returned: nothing was ever written again and, because the early
  // return happens before the try, nothing was reported either — the status
  // line kept saying "saved" for the rest of the session.
  localStorage.setItem(DRAFT_KEY, 'not valid yjs data');
  mockWebxdc([]);
  const restore = failStorage({ removeItem: true });
  let collab: ReturnType<typeof createCollab>;
  const saves: boolean[] = [];
  try {
    collab = createCollab((ok) => saves.push(ok));
    await settle();
  } finally {
    restore();
  }

  collab!.ytext.insert(0, 'work after a corrupt draft');
  background();
  assert.deepEqual(saves, [true], 'saving is still enabled and still reports');
  assert.ok(localStorage.getItem(DRAFT_KEY), 'and the new draft was written');
  localStorage.removeItem(DRAFT_KEY);
});
