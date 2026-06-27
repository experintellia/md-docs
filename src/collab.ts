import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import WebxdcProvider from 'y-webxdc';

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
  const { webxdc } = window;
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
      return {
        document,
        summary: `Last edit: ${webxdc.selfName}`,
        startinfo: `${webxdc.selfName} started a document`,
      };
    },
  });

  return { ydoc, ytext, awareness, undoManager, provider };
}
