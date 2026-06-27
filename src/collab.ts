import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import WebxdcProvider from 'y-webxdc';

/**
 * The shared collaboration state: a Yjs document synced to chat peers via the
 * webxdc persistent channel, plus the pieces `yCollab` needs (text, awareness,
 * undo manager). See PLAN.md Phase 2.
 *
 * Remote cursors won't go *live* until the deferred realtime transport lands
 * (PLAN.md "LATER"); awareness is wired now so that flip is small.
 */
export interface Collab {
  ytext: Y.Text;
  awareness: Awareness;
  undoManager: Y.UndoManager;
  provider: WebxdcProvider;
}

export function createCollab(): Collab {
  const { webxdc } = window;
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('codemirror');
  // ponytail: awareness is created so yCollab can bind it, but local cursor
  // state (name/color) is set in the LATER transport phase — without the
  // realtime channel no peer ever receives it, so setting it now is dead.
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
      const document = (ytext.toString().split('\n', 1)[0] || 'Untitled').slice(0, 60);
      return {
        document,
        summary: `Last edit: ${webxdc.selfName}`,
        startinfo: `${webxdc.selfName} started a document`,
      };
    },
  });

  return { ytext, awareness, undoManager, provider };
}
