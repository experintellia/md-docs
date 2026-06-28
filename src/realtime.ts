import * as Y from 'yjs';
import {
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
  type Awareness,
} from 'y-protocols/awareness';

const DOC = 0;
const AWARENESS = 1;

/**
 * Live transport over webxdc's *ephemeral* realtime channel: it carries Yjs
 * document updates (so typing shows up instantly) AND awareness (cursors).
 * `y-webxdc` still owns the *persistent* channel for durable / offline catch-up
 * — this sits beside it, untouched.
 *
 * Both transports feed the same Y.Doc, and Yjs is a CRDT, so applying an update
 * from either channel — even the same update twice — converges. That's also why
 * cursors are never stranded: the edit a remote cursor points into arrives on
 * the same fast channel as the cursor itself.
 *
 * One channel carries two message kinds, distinguished by a leading tag byte.
 */
export function connectRealtime(ydoc: Y.Doc, awareness: Awareness): void {
  const { webxdc } = window;
  if (!webxdc.joinRealtimeChannel) return; // experimental; feature-detect per spec

  // Cursor identity yCollab renders with (reads awareness `user.{name,color}`).
  // Colour is a stable hash of the address so each peer keeps one colour.
  const hue = [...webxdc.selfAddr].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  awareness.setLocalStateField('user', {
    name: webxdc.selfName,
    color: `hsl(${hue} 70% 50%)`,
    // Selection fill: semi-transparent mid-tone so it reads as a tint on both
    // the light and dark editor backgrounds (an opaque pale colour vanished
    // under the light text in dark mode). The viewer's theme isn't known here.
    colorLight: `hsl(${hue} 70% 50% / 0.35)`,
  });

  const channel = webxdc.joinRealtimeChannel();
  // Prefix the tag by allocate-and-set, NOT Uint8Array.of(tag, ...body): spreading
  // body into call arguments overflows the engine's arg-count limit (~64k) for a
  // full-state catch-up of a large doc, throwing RangeError. Small dev payloads
  // never hit it; a real document does.
  const frame = (tag: number, body: Uint8Array): Uint8Array => {
    const out = new Uint8Array(body.length + 1);
    out[0] = tag;
    out.set(body, 1);
    return out;
  };

  channel.setListener((data) => {
    const body = data.subarray(1);
    // Pass `channel` as the origin so our own update/awareness handlers below
    // don't echo it straight back out.
    if (data[0] === DOC) Y.applyUpdate(ydoc, body, channel);
    else applyAwarenessUpdate(awareness, body, channel);
  });

  ydoc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== channel) channel.send(frame(DOC, update));
  });

  awareness.on(
    'update',
    ({ added, updated, removed }: Record<string, number[]>) => {
      const changed = [...added, ...updated, ...removed];
      channel.send(frame(AWARENESS, encodeAwarenessUpdate(awareness, changed)));
    },
  );

  // Late-joiner catch-up: blast our full state once so peers already online
  // merge it. ponytail: full-state, not the sync-protocol step1/step2
  // handshake — fine for small docs / few peers; switch to syncProtocol if an
  // O(peers) full-state storm starts to hurt.
  channel.send(frame(DOC, Y.encodeStateAsUpdate(ydoc)));
}
