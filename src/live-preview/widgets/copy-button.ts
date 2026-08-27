import { WidgetType } from '@codemirror/view';

/**
 * "Copy" button pinned to the opening fence of a code block. Copies the block's
 * body (without the ``` fences) to the clipboard and confirms in place.
 */
export class CopyButtonWidget extends WidgetType {
  readonly code: string;

  constructor(code: string) {
    super();
    this.code = code;
  }

  override eq(other: CopyButtonWidget): boolean {
    return other.code === this.code;
  }

  override toDOM(): HTMLElement {
    const button = document.createElement('button');
    button.className = 'md-copy';
    button.type = 'button';
    button.textContent = 'Copy';
    button.setAttribute('aria-label', 'Copy code block');
    button.addEventListener('mousedown', (event) => {
      // The editor is contenteditable: without this the click moves the cursor
      // into the code block (and blurs nothing, so the copy still runs).
      event.preventDefault();
      void copy(this.code).then((ok) => {
        button.textContent = ok ? 'Copied' : 'Failed';
        setTimeout(() => { button.textContent = 'Copy'; }, 1200);
      });
    });
    return button;
  }

  /** Keep clicks away from CodeMirror's own selection handling. */
  override ignoreEvent(): boolean {
    return false;
  }
}

async function copy(text: string): Promise<boolean> {
  // ponytail: the async clipboard API is missing or permission-blocked in some
  // of the messengers' embedded webviews, so the execCommand path is not
  // legacy cruft here — it is the only one that works there.
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the textarea path
    }
  }
  const scratch = document.createElement('textarea');
  scratch.value = text;
  scratch.setAttribute('readonly', '');
  scratch.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(scratch);
  scratch.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  scratch.remove();
  return ok;
}
