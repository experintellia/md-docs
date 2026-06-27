import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { connectRealtime } from './realtime.ts';

// Tier 2: realtime transport behaviour, driven through the public
// `connectRealtime` with a MOCK webxdc. Wire framing: `Uint8Array.of(tag,
// ...body)`, tag 0 = DOC, tag 1 = AWARENESS; the listener reads `data[0]` and
// `data.subarray(1)`. No production code is touched.

type Listener = (data: Uint8Array) => void;

interface Harness {
  ydoc: Y.Doc;
  awareness: Awareness;
  sent: Uint8Array[];
  fire: Listener; // the listener connectRealtime registered
}

// Fresh mock window + ydoc/awareness per test so global state can't bleed.
// `withChannel: false` simulates a viewer without the experimental realtime API.
function setup(withChannel = true): Harness {
  const sent: Uint8Array[] = [];
  let listener: Listener = () => {};
  const channel = {
    setListener: (l: Listener) => { listener = l; },
    send: (d: Uint8Array) => { sent.push(d); },
    leave: () => {},
  };
  const webxdc = {
    selfAddr: 'alice@example.com',
    selfName: 'Alice',
    ...(withChannel ? { joinRealtimeChannel: () => channel } : {}),
  };
  (globalThis as unknown as { window: { webxdc: typeof window.webxdc } }).window = {
    webxdc: webxdc as unknown as typeof window.webxdc,
  };

  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  connectRealtime(ydoc, awareness);
  return { ydoc, awareness, sent, fire: (data) => listener(data) };
}

const tagCount = (sent: Uint8Array[], tag: number): number =>
  sent.filter((f) => f[0] === tag).length;

test('connect sends a DOC catch-up frame for late joiners', () => {
  const { sent } = setup();
  assert.equal(sent[0][0], 0); // leading byte 0 = DOC
});

test('a local document edit re-broadcasts as a DOC frame', () => {
  const { ydoc, sent } = setup();
  const before = tagCount(sent, 0);
  ydoc.getText('codemirror').insert(0, 'hi');
  assert.ok(tagCount(sent, 0) > before, 'a new DOC frame was sent');
  assert.equal(sent[sent.length - 1][0], 0); // latest frame is DOC
});

test('an incoming DOC frame is applied but not echoed back', () => {
  const { ydoc, sent, fire } = setup();
  const other = new Y.Doc();
  other.getText('codemirror').insert(0, 'remote');
  const frame = Uint8Array.of(0, ...Y.encodeStateAsUpdate(other));

  const before = sent.length;
  fire(frame);

  assert.equal(ydoc.getText('codemirror').toString(), 'remote'); // applied
  assert.equal(sent.length, before); // echo suppressed (origin === channel)
});

test('an awareness change is sent as an AWARENESS frame', () => {
  const { awareness, sent } = setup();
  const before = tagCount(sent, 1);
  awareness.setLocalStateField('cursor', { x: 1 });
  assert.ok(tagCount(sent, 1) > before, 'a tag-1 AWARENESS frame was sent');
});

test('an incoming AWARENESS frame is routed without throwing', () => {
  const { awareness, fire } = setup();
  const peerDoc = new Y.Doc();
  const peer = new Awareness(peerDoc);
  peer.setLocalStateField('user', { name: 'Bob' });
  const frame = Uint8Array.of(1, ...encodeAwarenessUpdate(peer, [peer.clientID]));

  assert.doesNotThrow(() => fire(frame));
  assert.ok(awareness.getStates().has(peer.clientID)); // peer state landed
});

test('without joinRealtimeChannel, connect is a no-op and sends nothing', () => {
  const { sent } = setup(false);
  assert.equal(sent.length, 0);
});
