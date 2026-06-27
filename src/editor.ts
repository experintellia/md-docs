import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, drawSelection, dropCursor } from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { livePreview } from './live-preview';
import { markdownKeymap } from './commands';

/**
 * Build the base set of CodeMirror extensions shared by every editor instance.
 *
 * Phase 0 keeps this intentionally small: markdown language + sane editing
 * defaults. Phase 1 adds the live-preview decoration layer and Phase 2 swaps
 * the local `history()` for the Yjs collaborative undo manager.
 */
export function baseExtensions(): Extension[] {
  return [
    history(),
    drawSelection(),
    dropCursor(),
    EditorView.lineWrapping,
    keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
    markdown({ base: markdownLanguage, codeLanguages: [] }),
    livePreview(),
  ];
}

/** Create and mount an editor into `parent`. */
export function createEditor(
  parent: HTMLElement,
  doc = '',
  extra: Extension[] = [],
): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [...baseExtensions(), ...extra],
    }),
  });
}
