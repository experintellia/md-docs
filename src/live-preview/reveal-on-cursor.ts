import type { EditorState } from '@codemirror/state';

/**
 * Obsidian-style "reveal on cursor": markdown syntax markers are hidden unless
 * the cursor / selection is on the same line, in which case the raw markup is
 * shown so it can be edited.
 *
 * We reveal per-line (not per-node): if any selection range touches the line
 * that contains `pos`, that line's markers stay visible.
 */
export function lineHasSelection(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  return state.selection.ranges.some(
    (r) => r.from <= line.to && r.to >= line.from,
  );
}
