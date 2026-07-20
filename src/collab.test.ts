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
