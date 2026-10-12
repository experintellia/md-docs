import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import WebxdcProvider from 'y-webxdc';
import { fromUint8Array, toUint8Array } from 'js-base64';
import { setupHistory, type History } from './history.ts';

// localStorage key for the synchronous crash/exit safety net (see below).
const DRAFT_KEY = 'md-docs-draft';
// The Yjs client IDs this device has edited under while those edits may still
// be missing from the chat. Every app start is a new ID; a restored draft's
// unsent tail is ours only if it carries one of these.
const OWN_KEY = 'md-docs-own-clients';

/** The clients with edits in `update` that `doc` does not have yet. */
function clientsAhead(update: Uint8Array, doc: Y.Doc): number[] {
  // Read from the encoded doc, not Y.encodeStateVector(doc): that leaves out
  // pending edits, ones the chat delivered that wait on edits still missing.
  // Ours would then look unsent. Counting stops at a gap, where a send was lost.
  const have = Y.decodeStateVector(Y.encodeStateVectorFromUpdateV2(Y.encodeStateAsUpdateV2(doc)));
  return [...Y.decodeStateVector(Y.encodeStateVectorFromUpdateV2(update))]
    .filter(([client, clock]) => clock > (have.get(client) ?? 0))
    .map(([client]) => client);
}

/**
 * The shared collaboration state: a Yjs document synced to chat peers via the
 * webxdc persistent channel, plus the pieces `yCollab` needs (text, awareness,
 * undo manager). See PLAN.md Phase 2.
 *
 * Durable document sync rides this persistent channel; live typing and remote
 * cursors ride the faster ephemeral realtime channel (see realtime.ts). Both
 * feed this same Y.Doc.
 */
export interface Collab {
  ydoc: Y.Doc;
  ytext: Y.Text;
  awareness: Awareness;
  undoManager: Y.UndoManager;
  provider: WebxdcProvider;
  history: History;
}

/**
 * Reduce a markdown line to plaintext for use as the chat document title.
 * Covers the inline syntax the toolbar can produce: headings, emphasis,
 * inline code, links, and leading list/quote markers. ponytail: deliberately
 * not a full markdown parser — these are the cases that actually occur in a
 * one-line title; widen the regexes if other syntax shows up.
 */
export function titleFromMarkdown(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s+/, '')          // # heading
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '') // - / 1. list marker
    .replace(/^\s*>\s?/, '')               // > blockquote
    .replace(/^\s*\[[ xX]\]\s+/, '')       // [ ] checklist marker
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) / ![alt](url) -> inner
    .replace(/(\*\*|__|\*|_|`)(.+?)\1/g, '$2') // **b** *i* `c` -> inner text
    .replace(/[*_`]/g, '')                 // stray/unpaired markers
    .trim();
}

/**
 * @param onDraftSave notified after every attempt to write the on-device crash
 *   net, so a failure reaches the UI when it happens. A polled getter could not:
 *   the status line is repainted from provider `sync` events, and the flush that
 *   fires one during backgrounding runs BEFORE our visibilitychange handler — so
 *   the very failure this exists to report would have been painted a flush late,
 *   or not at all if the user never came back.
 */
export function createCollab(onDraftSave?: (ok: boolean) => void): Collab {
  // Wrap webxdc so every update batch carries author + timestamp, and the
  // version timeline can be rebuilt from the channel's replayed update stream.
  const history = setupHistory(window.webxdc);
  const webxdc = history.webxdc;
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('codemirror');
  // Bound by yCollab to render remote cursors; local cursor state and the
  // peer-to-peer transport are set up in realtime.ts (the realtime channel).
  const awareness = new Awareness(ydoc);
  const undoManager = new Y.UndoManager(ytext);

  // ponytail: no destroy() — a webxdc app is one long-lived page, nothing to
  // tear down. The provider's own visibilitychange/beforeunload flush handles
  // saving on close.
  // First line becomes the webxdc document title (shown in the chat), as
  // plaintext — markdown syntax would look like noise in the chat list.
  const title = (): string =>
    (titleFromMarkdown(ytext.toString().split('\n', 1)[0] || '') || 'Untitled').slice(0, 60);
  const provider = new WebxdcProvider({
    webxdc,
    ydoc,
    autosaveInterval: 10_000, // matches the webxdc default sendUpdateInterval
    getEditInfo: () => {
      // Compact local date+time of this (the latest) edit; getEditInfo runs at
      // each flush, so `new Date()` is the last-edit moment.
      const when = new Date().toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
      return {
        document: title(),
        summary: `Last edit: ${webxdc.selfName} · ${when}`,
        // Fired once per peer per session (y-webxdc guards it). Generic wording —
        // these are ordinary edits, not necessarily a brand-new document.
        startinfo: `${webxdc.selfName} updated the document`,
      };
    },
  });

  // Synchronous local safety net. The provider only persists via the async
  // webxdc.sendUpdate() (autosave loop + visibilitychange/beforeunload flush).
  // On iOS the webview is suspended the instant the app backgrounds, before
  // that async send reaches the messenger, so the un-flushed tail of edits is
  // lost. localStorage.setItem is synchronous and completes before suspension,
  // so we mirror the Yjs state to it and re-apply on load. Re-applying is a
  // no-op once already synced — Yjs is a CRDT, so merge needs no heuristics.

  // Restore is DEFERRED until the channel replay completes: applying the full
  // draft before replay made Yjs treat the whole doc as a fresh local edit,
  // which the provider queued → spurious "updated the document" notification
  // + full-doc re-send on every plain open. After replay, applying the draft
  // is a pure diff: fully-synced → no updateV2 fires (see collab.sync.test.ts)
  // → nothing to send. A genuinely unsent tail still goes out:
  // - Our own edits re-queue, so the next flush sends them under our name, and
  //   that one SHOULD notify.
  // - Other people's edits, which reached us over realtime before their author's
  //   send reached the chat (or never did), go out as a quiet re-send. They
  //   aren't ours to claim, but they're kept: they may exist nowhere else, and
  //   our own later edits can't be applied by a peer that lacks them.
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(DRAFT_KEY);
  } catch (err) {
    // Some engines throw on EVERY storage access, not only when full (Firefox
    // with cookies disabled, a third-party-blocked Chromium iframe). Reading
    // the draft must not be able to stop the editor from starting.
    console.warn('collab: local storage unavailable', err);
    onDraftSave?.(false);
  }
  // null when never written or unreadable: then a draft's unsent edits are
  // treated as ours, as before this key existed (bar a pure deletion, below).
  let own: number[] | null = null;
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(OWN_KEY) ?? 'null');
    if (Array.isArray(ids)) own = ids as number[];
  } catch {
    // Unreadable; see above.
  }
  let restored = false;
  // Runs before any save, since saveDraft waits for `restored`: this session's
  // ID must be on the list before a draft can hold its edits.
  const markRestored = (stillUnsent: number[]): void => {
    try {
      localStorage.setItem(OWN_KEY, JSON.stringify([...stillUnsent, ydoc.clientID]));
    } catch {
      // Blocked or full; the save path reports it. Our unsent edits would then
      // go out quietly on the next start, still not lost.
    }
    restored = true;
  };
  if (!saved) markRestored([]);
  else {
    const draft = saved;
    const applyDraft = (): void => {
      // Our earlier sessions' IDs stay listed while their edits are missing
      // from the chat: the send queued below can be lost too.
      let stillUnsent: number[] = [];
      try {
        const update = toUint8Array(draft);
        const unsent = clientsAhead(update, ydoc);
        stillUnsent = own ? unsent.filter((id) => own.includes(id)) : unsent;
        // ponytail: a pure deletion carries no client ID, so an unsent one of
        // ours goes out quietly too (data intact, no info line). Telling it
        // apart needs to know which of our sends landed; build that only if
        // the missing line is ever missed.
        if (stillUnsent.length > 0) {
          Y.applyUpdateV2(ydoc, update);
        } else {
          // Our client ID as the origin is what the provider and realtime.ts
          // read as "from the chat": neither queues nor re-broadcasts it.
          const tail: Uint8Array[] = [];
          const grab = (u: Uint8Array): void => { tail.push(u); };
          ydoc.on('updateV2', grab);
          try {
            Y.applyUpdateV2(ydoc, update, ydoc.clientID);
          } finally {
            ydoc.off('updateV2', grab);
          }
          if (tail.length) history.resend(fromUint8Array(Y.mergeUpdatesV2(tail)), title());
        }
      } catch {
        // Corrupt/garbage draft — drop it rather than block startup.
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch {
          // Blocked or read-only store; the save path reports it.
        }
      } finally {
        // Has to run even when dropping the draft failed. Otherwise every later
        // save early-returns on `!restored` and the net is off for the rest of
        // the session — while the status line still reads "saved".
        markRestored(stillUnsent);
      }
    };
    // then(f, f) + timeout race: a rejected or never-settling replay promise
    // (spec violation) must not strand the draft forever — worst case on such
    // a client is the old apply-before-replay behavior, 10s late.
    const timeout = new Promise<void>((r) => setTimeout(r, 10_000));
    Promise.race([history.replayed(), timeout]).then(applyDraft, applyDraft);
  }

  // ponytail: snapshots the full doc state as base64 on each save — fine for
  // markdown-sized docs. Switch to an incremental update log only if docs grow
  // large enough to stall the synchronous write (cf. commit 2f71303).
  const saveDraft = () => {
    // Never clobber a draft that hasn't been restored yet — its unsent tail
    // would be lost if the app backgrounds during the replay window.
    if (!restored) return;
    try {
      localStorage.setItem(DRAFT_KEY, fromUint8Array(Y.encodeStateAsUpdateV2(ydoc)));
      onDraftSave?.(true);
    } catch (err) {
      // Quota exhausted, or storage blocked entirely. This runs from a
      // visibilitychange handler and from a timer, so an uncaught throw here
      // went nowhere and the crash net just stopped working in silence — the
      // one failure it exists to prevent. A failed setItem leaves the PREVIOUS
      // value intact, so we fall back to an older snapshot, not to nothing.
      console.warn('collab: could not save the local draft', err);
      onDraftSave?.(false);
    }
  };

  // The line that fixes the reported iOS loss: a synchronous write the moment
  // the app backgrounds, before the webview is frozen.
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveDraft();
  });

  // Debounced save on edit, to also cover a hard kill with no visibilitychange.
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  ydoc.on('updateV2', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 1000);
  });

  return { ydoc, ytext, awareness, undoManager, provider, history };
}
