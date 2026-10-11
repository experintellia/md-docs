import { type EditorView, WidgetType } from '@codemirror/view';

type Katex = typeof import('katex').default;

// ponytail: KaTeX is ~260 KB of script, so it loads the first time a document
// actually shows math, not with the app. Until then the block shows its TeX.
// Its stylesheet is not part of this: that comes with the app (see main.ts),
// and the fonts it names are only fetched once a formula uses them.
let katex: Katex | undefined;
let loading: Promise<Katex> | undefined;
function loadKatex(): Promise<Katex> {
  return loading ??= import('katex').then((m) => (katex = m.default));
}

function render(k: Katex, el: HTMLElement, tex: string): void {
  try {
    k.render(tex, el, {
      displayMode: true,
      // Half-typed TeX renders as red source with the error in its tooltip
      // instead of throwing.
      throwOnError: false,
      // A bare `\\` is a no-op in LaTeX display math, and KaTeX warns on every
      // render that it breaks the line anyway. Breaking it is what people mean.
      strict: 'ignore',
      // The document comes from other chat members. `trust` stays off, which
      // keeps links, images and raw HTML classes out; and a size given in the
      // TeX (`\rule{500em}{500em}`) is capped at 50em, so nobody can plant a
      // block a mile tall.
      maxSize: 50,
    });
  } catch {
    // Not a parse error (those are rendered, above) — leave the source up.
    el.textContent = tex;
  }
}

/**
 * A `$$ … $$` block, typeset. Replaces the block while the cursor is elsewhere,
 * like a table; `buildMath` leaves the source as soon as the selection touches
 * it.
 */
export class MathWidget extends WidgetType {
  readonly tex: string;

  constructor(tex: string) {
    super();
    this.tex = tex;
  }

  override eq(other: MathWidget): boolean {
    return other.tex === this.tex;
  }

  override toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('div');
    el.className = 'md-math';
    // TeX lays itself out left to right, whatever the text around it reads in.
    el.dir = 'ltr';
    // A widget swallows its events, so a tap would never reach the source —
    // and a phone has no arrow key to get there instead. Asked of the DOM, not
    // remembered from when it was built: text typed above moves the block, and
    // an equal widget keeps this element.
    el.addEventListener('mousedown', (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: view.posAtDOM(el) } });
    });
    if (katex) {
      render(katex, el, this.tex);
    } else {
      el.textContent = this.tex;
      loadKatex().then((k) => {
        render(k, el, this.tex);
        // The block just changed height under CodeMirror's feet.
        if (el.isConnected) view.requestMeasure();
      }, () => { /* the source stays up */ });
    }
    return el;
  }
}
