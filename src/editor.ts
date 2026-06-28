import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, drawSelection, dropCursor } from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { livePreview } from './live-preview';
import { markdownKeymap } from './commands';
import { hidePeerFlagsWhenCovered } from './peer-flags';
import type { Collab } from './collab';

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
      keymap.of(yUndoManagerKeymap),
      hidePeerFlagsWhenCovered, // mobile: keep peer flags off the local cursor
    ]
    : [history(), keymap.of(historyKeymap)];

  return [
    ...undo,
    drawSelection(),
    dropCursor(),
    EditorView.lineWrapping,
    keymap.of([...markdownKeymap, ...defaultKeymap, indentWithTab]),
    // addKeymap:false — our markdownKeymap binds Enter/Backspace instead (with
    // tight-list continuation); see commands.ts.
    markdown({ base: markdownLanguage, codeLanguages: [], addKeymap: false }),
    livePreview(),
  ];
}

/** Create and mount an editor into `parent`. */
export function createEditor(
  parent: HTMLElement,
  doc = '',
  extra: Extension[] = [],
  collab?: Collab,
): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [...baseExtensions(collab), ...extra],
    }),
  });
}
