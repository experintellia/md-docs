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
    // The editor is contenteditable, so a press inside it would move the
    // caret into the code block. CodeMirror already stays out of the way --
    // WidgetType.ignoreEvent defaults to ignoring everything inside a widget --
    // and preventDefault stops the browser's own focus/selection shift.
    button.addEventListener('mousedown', (event) => { event.preventDefault(); });
    // click, not mousedown: Enter and Space on a focused button fire only click,
    // and this one is reachable by keyboard on desktop.
    button.addEventListener('click', () => {
      void copy(this.code).then((ok) => {
        button.textContent = ok ? 'Copied' : 'Failed';
        setTimeout(() => { button.textContent = 'Copy'; }, 1200);
      });
    });
    return button;
  }
}

async function copy(text: string): Promise<boolean> {
  // ponytail: the async clipboard API is missing or permission-blocked in some
  // of the messengers' embedded webviews, so the execCommand path is not
  // legacy cruft here — it is the only one that works there. Ceiling: when the
  // API is present but *rejects*, the fallback runs a tick later, outside the
  // user gesture, and WebKit refuses execCommand there. Try execCommand first
  // if a real iOS webview turns out to take that branch.
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
