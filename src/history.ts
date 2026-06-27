import * as Y from 'yjs';

/**
 * Document history, reconstructed from the webxdc update stream.
 *
 * We capture nothing of our own: the webxdc persistent channel already stores
 * every update batch and replays the whole log on each launch (that's how a
 * fresh device catches up — see y-webxdc's `setUpdateListener`). So we just
 * observe that stream and rebuild a timeline, which means edits made while we
 * were offline show up after the fact, the moment the messenger delivers them.
 *
 * The only thing missing from the raw Yjs data is *who* and *when*: that lives
 * in the webxdc envelope, not the update. So we wrap the webxdc object passed to
 * the provider and stamp `{ t, author }` onto each outgoing payload — a few extra
 * bytes that then travel with every version, including historical/offline ones.
 */
export interface HistoryEntry {
  /** index into the underlying record list, for `textAt()` */
  index: number;
  t: number;
  author: string;
}

export interface History {
  /** webxdc shim to hand to `new WebxdcProvider({ webxdc })` */
  webxdc: typeof window.webxdc;
  /** versions in chronological (receipt) order */
  list(): HistoryEntry[];
  /** the document text as of version `index` */
  textAt(index: number): string;
  onChange(cb: () => void): void;
}

interface Record {
  t: number;
  author: string;
  blob: string; // base64 Yjs updateV2, as the provider serializes it
}

// The provider's payload, plus the metadata our shim injects.
interface HistPayload {
  serializedYjsUpdate?: string;
  t?: number;
  author?: string;
}

export function setupHistory(real: typeof window.webxdc): History {
  // Receipt order, NOT sorted by `t`: the channel delivers updates in a causally
  // consistent serial order, and Yjs needs each prefix to be causally complete to
  // reconstruct it. ponytail: a prefix can still miss a cross-peer dependency under
  // clock skew, making an intermediate version look slightly off — the latest
  // version is always exact. Good enough for a timeline; revisit only if it bites.
  const records: Record[] = [];
  const listeners: Array<() => void> = [];
  const emit = (): void => { for (const cb of listeners) cb(); };

  const author = real.selfName || 'unknown';

  // setUpdateListener fires for our own sends (echoed back), peers' sends, AND the
  // full startup replay — so it's the single funnel for the whole timeline. We do
  // NOT record in sendUpdate (that would double-count the echo); send only injects.
  const webxdc = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'sendUpdate') {
        return (update: { payload: HistPayload }, descr: '') => {
          update.payload.t = Date.now();
          update.payload.author = author;
          return (target.sendUpdate as typeof real.sendUpdate)(update as never, descr);
        };
      }
      if (prop === 'setUpdateListener') {
        return (cb: (u: { payload: HistPayload }) => void, serial?: number) => {
          const wrapped = (u: { payload: HistPayload }): void => {
            const p = u.payload;
            if (typeof p?.serializedYjsUpdate === 'string') {
              records.push({
                t: typeof p.t === 'number' ? p.t : Date.now(),
                author: typeof p.author === 'string' ? p.author : 'unknown',
                blob: p.serializedYjsUpdate,
              });
              emit();
            }
            cb(u);
          };
          return (target.setUpdateListener as typeof real.setUpdateListener)(
            wrapped as never,
            serial,
          );
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as typeof window.webxdc;

  return {
    webxdc,
    list: () => records.map((r, index) => ({ index, t: r.t, author: r.author })),
    textAt: (index) => {
      const doc = new Y.Doc();
      for (let k = 0; k <= index && k < records.length; k++) {
        Y.applyUpdateV2(doc, b64ToBytes(records[k].blob));
      }
      const text = doc.getText('codemirror').toString();
      doc.destroy();
      return text;
    },
    onChange: (cb) => { listeners.push(cb); },
  };
}

// Decode the provider's base64 payload natively — avoids importing js-base64
// (a transitive y-webxdc dep we'd rather not depend on directly).
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
