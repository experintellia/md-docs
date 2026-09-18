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
  /**
   * Resolves once the channel's startup replay has been delivered (webxdc's
   * setUpdateListener promise, which y-webxdc discards). Resolves immediately
   * on clients whose setUpdateListener returns void.
   */
  replayed(): Promise<void>;
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

/**
 * Poison-batch guard.
 *
 * Applying a batch can abort the whole process rather than throw. yjs reads a
 * struct count straight off the wire — `new Array(numberOfStructs)` in
 * `readClientsStructRefs`, from an unvalidated varuint — so a corrupt or
 * hostile value there makes V8 die with "FATAL ERROR: Allocation failed -
 * JavaScript heap out of memory". That is not a catchable exception, so no
 * try/catch around the decode can help, and y-webxdc applies the same bytes
 * unguarded before we ever see them. The guard therefore has to sit in front of
 * both, and it cannot work by inspecting the batch: telling a poisoned batch
 * from a good one means decoding it, which is the thing that kills us.
 *
 * What makes this worth guarding at all is that the channel replays its whole
 * log on every launch. One such batch kills the app on open, every time, on
 * every peer's device — a permanently unusable document, with no way back from
 * inside the app. So instead of validating: write down the batch we are about
 * to apply, and if that note is still there on the next launch, that batch is
 * what killed us. Quarantine it and never hand it to the decoder again.
 *
 * The real fix belongs upstream (yjs bounding the count, or y-webxdc guarding
 * the apply); this keeps one bad batch from being fatal in the meantime.
 *
 * ponytail: two synchronous localStorage writes per incoming batch, which on a
 * long startup replay is the whole cost of this guard. Cheap against an
 * unrecoverable failure. If replay latency ever shows up, arm only for batches
 * not already seen rather than dropping the guard.
 */
const POISON_KEY = 'md-docs-poison-batches';

interface PoisonState {
  /** the batch currently being decoded — set before, cleared after */
  pending: string | null;
  /** batches a previous run died on */
  bad: string[];
}

function readPoison(): PoisonState {
  try {
    const raw = JSON.parse(localStorage.getItem(POISON_KEY) ?? '{}') as {
      pending?: unknown;
      bad?: unknown;
    };
    return {
      pending: typeof raw?.pending === 'string' ? raw.pending : null,
      bad: Array.isArray(raw?.bad)
        ? raw.bad.filter((x: unknown): x is string => typeof x === 'string')
        : [],
    };
  } catch {
    // No storage (webview private mode), or a corrupt note: the guard degrades
    // to off rather than taking startup down with it.
    return { pending: null, bad: [] };
  }
}

function writePoison(state: PoisonState): void {
  try {
    localStorage.setItem(POISON_KEY, JSON.stringify(state));
  } catch {
    // As above — an unavailable store disables the guard, nothing more.
  }
}

// A cheap content id for a batch. Not cryptographic: it only has to tell one
// batch apart from the others in this document's log.
function fingerprint(blob: string): string {
  let h = 0;
  for (let i = 0; i < blob.length; i++) h = (Math.imul(h, 31) + blob.charCodeAt(i)) | 0;
  return `${blob.length}:${(h >>> 0).toString(36)}`;
}

export function setupHistory(real: typeof window.webxdc): History {
  // Receipt order, NOT sorted by `t`: the channel delivers updates in a causally
  // consistent serial order, and Yjs needs each prefix to be causally complete to
  // reconstruct it. ponytail: a prefix can still miss a cross-peer dependency under
  // clock skew, making an intermediate version look slightly off — the latest
  // version is always exact. Good enough for a timeline; revisit only if it bites.
  const records: Record[] = [];
  const listeners: Array<() => void> = [];
  const emit = (): void => {
    for (const cb of listeners) {
      try {
        cb();
      } catch (err) {
        // One failing listener must not skip the others, nor escape into the
        // webxdc host's dispatch loop on its way out.
        console.error('history: an onChange listener failed', err);
      }
    }
  };

  const author = real.selfName || 'unknown';
  // A note left behind by the previous run means we never reached the line that
  // clears it: that batch killed the process mid-decode. Quarantine it.
  const poison = readPoison();
  if (poison.pending !== null) {
    if (!poison.bad.includes(poison.pending)) poison.bad.push(poison.pending);
    poison.pending = null;
    writePoison(poison);
  }
  // Captured from setUpdateListener below; read via History.replayed().
  let replayed: Promise<void> = Promise.resolve();
  // One-shot: set by markRestore(), consumed by the next outgoing batch.
  let pendingRestore: RestoreSource | null = null;

  // setUpdateListener fires for our own sends (echoed back), peers' sends, AND the
  // full startup replay — so it's the single funnel for the whole timeline. We do
  // NOT record in sendUpdate (that would double-count the echo); send only injects.
  //
  // A plain delegating object, NOT a Proxy: in the real Delta Chat client the
  // webxdc methods are read-only, non-configurable properties, and a Proxy `get`
  // trap that returns a *different* setUpdateListener/sendUpdate violates a Proxy
  // invariant and throws ("'get' on proxy: property … is a read-only and
  // non-configurable data property …"). The dev mock's props are configurable, so
  // the Proxy only blew up on a real device. Object.create(real) lets every other
  // read — selfName, selfAddr, … — fall straight through to the native object;
  // defineProperty installs our two overrides as own props (a plain assignment
  // would throw under strict mode when shadowing real's non-writable methods).
  const webxdc = Object.create(real) as typeof window.webxdc;
  Object.defineProperty(webxdc, 'sendUpdate', {
    configurable: true,
    value: (update: { payload: HistPayload }, descr: '') => {
      update.payload.t = Date.now();
      update.payload.author = author;
      if (pendingRestore) {
        update.payload.restoredFrom = pendingRestore;
        pendingRestore = null;
      }
      return (real.sendUpdate as typeof real.sendUpdate)(update as never, descr);
    },
  });
  Object.defineProperty(webxdc, 'setUpdateListener', {
    configurable: true,
    value: (cb: (u: { payload: HistPayload }) => void, serial?: number) => {
      const wrapped = (u: { payload: HistPayload }): void => {
        const p = u.payload;
        const blob = typeof p?.serializedYjsUpdate === 'string' ? p.serializedYjsUpdate : null;
        let id: string | null = null;
        if (blob !== null) {
          id = fingerprint(blob);
          // Known to have killed a previous run: it never reaches a decoder
          // again, ours or the provider's.
          if (poison.bad.includes(id)) return;
          poison.pending = id;
          writePoison(poison);
        }
        // The provider first: history is bookkeeping, and a throw from one of
        // our onChange listeners must not stop the document itself from syncing.
        cb(u);
        if (blob !== null) {
          // Survived the decode, so it is not the batch that kills us.
          poison.pending = null;
          writePoison(poison);
          records.push({
            t: typeof p.t === 'number' ? p.t : Date.now(),
            author: typeof p.author === 'string' ? p.author : 'unknown',
            blob,
            restoredFrom: p.restoredFrom,
          });
          emit();
        }
      };
      replayed = Promise.resolve(
        (real.setUpdateListener as typeof real.setUpdateListener)(wrapped as never, serial),
      );
      return replayed;
    },
  });

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
        try {
          Y.applyUpdateV2(doc, b64ToBytes(r.blob));
        } catch {
          // A batch we cannot decode (truncated, or written by some other
          // app/format sharing the channel) skips its row rather than throwing
          // the whole timeline away — versions() is called from the update
          // listener, so one bad record would otherwise be permanent.
          continue;
        }
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
    replayed: () => replayed,
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
