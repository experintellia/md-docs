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
/** The earlier version a restore brought back. */
export interface RestoreSource {
  t: number;
  author: string;
}

export interface HistoryVersion {
  t: number;
  author: string;
  /** the full document text as of this version */
  text: string;
  /** characters added / removed vs the previous shown version */
  added: number;
  removed: number;
  /** set when this version was produced by restoring an earlier one */
  restoredFrom?: RestoreSource;
}

export interface History {
  /** webxdc shim to hand to `new WebxdcProvider({ webxdc })` */
  webxdc: typeof window.webxdc;
  /**
   * The timeline in chronological (receipt) order: each update batch
   * reconstructed to its full text, consecutive no-op batches (identical text)
   * dropped, and per-version char add/remove counts vs the previous shown one.
   */
  versions(): HistoryVersion[];
  /**
   * Tag the next outgoing batch as a restore of `from`, so the marker travels to
   * every peer alongside the doc edit. Call right before writing the restored
   * text into the doc.
   */
  markRestore(from: RestoreSource): void;
  onChange(cb: () => void): void;
}

interface Record {
  t: number;
  author: string;
  blob: string; // base64 Yjs updateV2, as the provider serializes it
  restoredFrom?: RestoreSource;
}

// The provider's payload, plus the metadata our shim injects.
interface HistPayload {
  serializedYjsUpdate?: string;
  t?: number;
  author?: string;
  restoredFrom?: RestoreSource;
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
  // One-shot: set by markRestore(), consumed by the next outgoing batch.
  let pendingRestore: RestoreSource | null = null;

  // setUpdateListener fires for our own sends (echoed back), peers' sends, AND the
  // full startup replay — so it's the single funnel for the whole timeline. We do
  // NOT record in sendUpdate (that would double-count the echo); send only injects.
  const webxdc = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'sendUpdate') {
        return (update: { payload: HistPayload }, descr: '') => {
          update.payload.t = Date.now();
          update.payload.author = author;
          if (pendingRestore) {
            update.payload.restoredFrom = pendingRestore;
            pendingRestore = null;
          }
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
                restoredFrom: p.restoredFrom,
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
    versions: () => {
      // One forward pass: apply each batch cumulatively into a single doc and
      // snapshot the text after each — O(n) applies, not O(n²) per-row replays.
      // ponytail: recomputed per call; the UI calls it once per render and reuses,
      // and n is small. Cache against a dirty flag only if it ever shows up hot.
      const doc = new Y.Doc();
      const out: HistoryVersion[] = [];
      let prev = '';
      for (const r of records) {
        Y.applyUpdateV2(doc, b64ToBytes(r.blob));
        const text = doc.getText('codemirror').toString();
        if (text === prev) continue; // drop consecutive no-op batches
        const { added, removed } = charDiff(prev, text);
        out.push({ t: r.t, author: r.author, text, added, removed, restoredFrom: r.restoredFrom });
        prev = text;
      }
      doc.destroy();
      return out;
    },
    markRestore: (from) => { pendingRestore = from; },
    onChange: (cb) => { listeners.push(cb); },
  };
}

// Added/removed character counts between two versions, by trimming the common
// prefix and suffix. Exact for a single contiguous edit; for a batch that edits
// two far-apart spots it reports the span covering both — a slight over-count,
// acceptable for ~10s batches whose edits are usually localized.
// ponytail: upgrade to a real word/line diff only if multi-region batches matter.
function charDiff(prev: string, next: string): { added: number; removed: number } {
  let p = 0;
  const min = Math.min(prev.length, next.length);
  while (p < min && prev[p] === next[p]) p++;
  let s = 0;
  while (s < min - p && prev[prev.length - 1 - s] === next[next.length - 1 - s]) s++;
  return { removed: prev.length - p - s, added: next.length - p - s };
}

// Decode the provider's base64 payload natively — avoids importing js-base64
// (a transitive y-webxdc dep we'd rather not depend on directly).
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
