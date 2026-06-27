import { WidgetType, type EditorView } from '@codemirror/view';

/**
 * A clickable task-list checkbox that replaces the raw `[ ]` / `[x]` marker.
 * Clicking toggles the marker text in the document (which round-trips through
 * Yjs once collaboration is wired up).
 */
export class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
    readonly to: number,
  ) {
    super();
  }

  override eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.from === this.from;
  }

  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'md-task-checkbox';
    box.checked = this.checked;
    box.addEventListener('mousedown', (e) => {
      // Toggle the underlying `[ ]` <-> `[x]` text without moving the cursor.
      e.preventDefault();
      const insert = this.checked ? '[ ]' : '[x]';
      view.dispatch({ changes: { from: this.from, to: this.to, insert } });
    });
    return box;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}
