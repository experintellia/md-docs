import { WidgetType, type EditorView } from '@codemirror/view';
import { onPress } from '../../ui/icon.ts';

// The widget each box currently shows. updateDOM hands the same <input> on to
// the next widget, so a box focused from the keyboard keeps focus when it
// ticks, instead of being replaced and dropping focus to <body>.
const shown = new WeakMap<HTMLElement, CheckboxWidget>();

/**
 * A clickable task-list checkbox that replaces the raw `[ ]` / `[x]` marker.
 * Clicking toggles the marker text in the document (which round-trips through
 * Yjs once collaboration is wired up).
 */
export class CheckboxWidget extends WidgetType {
  readonly checked: boolean;
  readonly from: number;
  readonly to: number;

  constructor(checked: boolean, from: number, to: number) {
    super();
    this.checked = checked;
    this.from = from;
    this.to = to;
  }

  override eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.from === this.from;
  }

  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'md-task-checkbox';
    box.checked = this.checked;
    // The task's text follows on the line; this says what ticking means.
    box.setAttribute('aria-label', 'Done');
    shown.set(box, this);
    // Toggle the underlying `[ ]` <-> `[x]` text without moving the cursor.
    // The document owns the tick: in read mode nothing changes, and onPress
    // then stops the native box flipping to a state the document doesn't have.
    onPress(box, () => {
      if (view.state.readOnly) return false; // read mode / history viewer
      const { checked, from, to } = shown.get(box)!;
      const focused = document.activeElement === box;
      view.dispatch({ changes: { from, to, insert: checked ? '[ ]' : '[x]' } });
      // Redrawing its selection, CodeMirror takes focus from a box inside it;
      // a keyboard user is still on this one, which updateDOM kept.
      if (focused) box.focus();
      return true;
    });
    return box;
  }

  override updateDOM(dom: HTMLElement): boolean {
    (dom as HTMLInputElement).checked = this.checked;
    shown.set(dom, this);
    return true;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}
