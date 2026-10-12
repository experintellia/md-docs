import { WidgetType, type EditorView } from '@codemirror/view';

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
    // Toggle the underlying `[ ]` <-> `[x]` text without moving the cursor.
    const toggle = (): void => {
      if (view.state.readOnly) return; // read mode / history viewer
      const insert = this.checked ? '[ ]' : '[x]';
      view.dispatch({ changes: { from: this.from, to: this.to, insert } });
    };
    box.addEventListener('mousedown', (e) => {
      e.preventDefault();
      toggle();
    });
    // The document owns the tick. Without this the click after a mousedown
    // that changed nothing (read mode) still flips the native box, which then
    // shows a state the document doesn't have. Space on a focused box fires
    // only this click (detail 0), so that one toggles here.
    box.addEventListener('click', (e) => {
      e.preventDefault();
      if (e.detail === 0) toggle();
    });
    return box;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}
