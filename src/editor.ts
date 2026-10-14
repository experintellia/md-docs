import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  drawSelection,
  dropCursor,
  type Command,
  type KeyBinding,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { livePreview } from './live-preview/index.ts';
import { codeLanguages } from './live-preview/code-languages.ts';
import { mathBlock } from './live-preview/math.ts';
import { markdownKeymap } from './commands.ts';
import { hidePeerFlagsWhenCovered } from './peer-flags.ts';
import type { Collab } from './collab.ts';

// Read mode is local to this viewer: peers keep editing and their changes keep
// arriving (readOnly only stops input, not dispatch). The live preview reads
// the same flag to stop revealing source on the caret's line.
const readMode = new Compartment();

// CodeMirror's own commands stand down in a read-only state; ours and
// y-codemirror's undo/redo don't, so guard every binding that edits.
function editing(bindings: readonly KeyBinding[]): KeyBinding[] {
  const guard = (run?: Command): Command | undefined =>
    run && ((view) => !view.state.readOnly && run(view));
  return bindings.map((b) => ({ ...b, run: guard(b.run), shift: guard(b.shift) }));
}

/**
 * Build the base set of CodeMirror extensions shared by every editor instance.
 *
 * With `collab`, undo/redo and document state are driven by Yjs (`yCollab` +
 * its undo-manager keymap); without it we fall back to the local `history()`
 * stack so the editor still works standalone (and in tests).
 */
export function baseExtensions(collab?: Collab): Extension[] {
  const undo = collab
    ? [
      yCollab(collab.ytext, collab.awareness, { undoManager: collab.undoManager }),
      keymap.of(editing(yUndoManagerKeymap)),
      hidePeerFlagsWhenCovered, // mobile: keep peer flags off the local cursor
      // y-codemirror publishes our caret while the editor has focus and never
      // withdraws it. A reader has no caret, so take it off peers' screens on
      // the way into read mode; the next focus in edit mode publishes it again.
      EditorView.updateListener.of((u) => {
        if (u.state.readOnly && !u.startState.readOnly) {
          collab.awareness.setLocalStateField('cursor', null);
        }
      }),
    ]
    : [history(), keymap.of(historyKeymap)];

  return [
    ...undo,
    drawSelection(),
    dropCursor(),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': 'Document' }),
    keymap.of([...editing(markdownKeymap), ...defaultKeymap, indentWithTab]),
    // addKeymap:false — our markdownKeymap binds Enter/Backspace instead (with
    // tight-list continuation); see commands.ts.
    markdown({ base: markdownLanguage, codeLanguages, addKeymap: false, extensions: [mathBlock] }),
    livePreview(),
    readMode.of([]),
  ];
}

/** Switch this viewer between reading and editing. */
export function setReadMode(view: EditorView, on: boolean): void {
  view.dispatch({
    effects: readMode.reconfigure(
      on ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
    ),
  });
}

/** Create and mount an editor into `parent`. */
export function createEditor(
  parent: HTMLElement,
  doc = '',
  extra: Extension[] = [],
  collab?: Collab,
): EditorView {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [...baseExtensions(collab), ...extra],
    }),
  });
  // Below the last line is .cm-scroller's padding (room to scroll past the
  // end), outside .cm-content where CodeMirror listens. Chromium snaps a click
  // there to the nearest caret position; WebKit does nothing. Put it at the end.
  // Only when the press started there too: a drag from the text into the
  // padding also ends in a click on the scroller, and must keep its selection.
  let downOnScroller = false;
  view.scrollDOM.addEventListener('pointerdown', (e) => {
    downOnScroller = e.target === view.scrollDOM;
  });
  view.scrollDOM.addEventListener('click', (e) => {
    if (!downOnScroller || e.target !== view.scrollDOM) return;
    if (e.clientY < view.contentDOM.getBoundingClientRect().bottom) return;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.focus();
  });
  return view;
}
