import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';

const coarse = (): boolean => window.matchMedia('(pointer: coarse)').matches;

/**
 * Mobile only: the always-on peer name flag (`.cm-ySelectionInfo`) floats just
 * above its caret, so it can land right on top of what you're editing. Hide a
 * flag whenever the local cursor/selection sits on a line the flag would cover.
 *
 * ponytail: line-granular, not pixel-rect intersection — it ignores the flag's
 * horizontal extent, so it errs toward hiding (never toward covering). Switch
 * to coordsAtPos rect-overlap if it turns out to hide too eagerly.
 */
function hideCoveredFlags(view: EditorView): void {
  const { doc } = view.state;
  const localLines = new Set<number>();
  for (const r of view.state.selection.ranges) {
    for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) {
      localLines.add(n);
    }
  }

  for (const flag of view.dom.querySelectorAll<HTMLElement>('.cm-ySelectionInfo')) {
    const caret = flag.closest<HTMLElement>('.cm-ySelectionCaret');
    if (!caret) continue;
    const caretLine = doc.lineAt(view.posAtDOM(caret)).number;
    // The flag sits a line above the caret (CSS top: -1.05em) and grazes the
    // caret line — cover either and it overlaps the local cursor.
    const covered = localLines.has(caretLine) || localLines.has(caretLine - 1);
    flag.style.visibility = covered ? 'hidden' : '';
  }
}

export const hidePeerFlagsWhenCovered = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      if (coarse()) hideCoveredFlags(view);
    }

    update(update: ViewUpdate): void {
      if (coarse()) hideCoveredFlags(update.view);
    }
  },
);
