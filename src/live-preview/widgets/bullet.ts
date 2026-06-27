import { WidgetType } from '@codemirror/view';

/**
 * Renders a list bullet (•) in place of the raw `-` / `*` / `+` marker on
 * non-active lines. Plain decoration — all bullets look identical.
 */
export class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'md-bullet';
    span.textContent = '•';
    return span;
  }
}
