import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import WebxdcProvider from 'y-webxdc';
import { fromUint8Array, toUint8Array } from 'js-base64';
import { setupHistory, type History } from './history.ts';

// localStorage key for the synchronous crash/exit safety net (see below).
const DRAFT_KEY = 'md-docs-draft';

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
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) -> text
    .replace(/(\*\*|__|\*|_|`)(.+?)\1/g, '$2') // **b** *i* `c` -> inner text
    .replace(/[*_`]/g, '')                 // stray/unpaired markers
    .trim();
}

export function createCollab(): Collab {
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
  const provider = new WebxdcProvider({
    webxdc,
    ydoc,
    autosaveInterval: 10_000, // matches the webxdc default sendUpdateInterval
    getEditInfo: () => {
      // First line becomes the webxdc document title (shown in the chat), as
      // plaintext — markdown syntax would look like noise in the chat list.
      const firstLine = ytext.toString().split('\n', 1)[0] || '';
      const document = (titleFromMarkdown(firstLine) || 'Untitled').slice(0, 60);
      // Compact local date+time of this (the latest) edit; getEditInfo runs at
      // each flush, so `new Date()` is the last-edit moment.
      const when = new Date().toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
      return {
        document,
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
  // → nothing queued; a genuinely unsent tail still re-queues, so the next
  // flush re-propagates it to peers — and that one SHOULD notify.
  const saved = localStorage.getItem(DRAFT_KEY);
  let restored = !saved;
  if (saved) {
    const applyDraft = (): void => {
      try {
        Y.applyUpdateV2(ydoc, toUint8Array(saved));
      } catch {
        // Corrupt/garbage draft — drop it rather than block startup.
        localStorage.removeItem(DRAFT_KEY);
      }
      restored = true;
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
    localStorage.setItem(DRAFT_KEY, fromUint8Array(Y.encodeStateAsUpdateV2(ydoc)));
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
