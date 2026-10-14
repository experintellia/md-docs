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

// The document comes from other chat members, and typesetting runs on the UI
// thread of everyone who has it open. A macro is how a few bytes become a lot
// of work: KaTeX caps how many expansions run, not how much each one yields,
// so `\def\a{…}` and a thousand `\a` (2 KB) froze the editor for 80 seconds,
// again on every peer each time it scrolled into view. So a note cannot define
// macros; each command that would is an error instead. These are all of
// KaTeX's definers.
const DEFINERS = [
  '\\def', '\\gdef', '\\edef', '\\xdef', '\\let', '\\futurelet', '\\global', '\\long',
  '\\newcommand', '\\renewcommand', '\\providecommand',
];

// Past this, plain size is the cost: typesetting grows faster than the TeX
// does. 10,000 characters takes up to 0.13 s on a laptop; no hand-written
// formula comes near it.
export const MAX_TEX = 10_000;

export function render(k: Katex, el: HTMLElement, tex: string, displayMode = true): void {
  if (tex.length > MAX_TEX) {
    el.textContent = tex;
    el.title = `Too long to typeset (over ${MAX_TEX} characters)`;
    return;
  }
  try {
    k.render(tex, el, {
      displayMode,
      // Half-typed TeX renders as red source with the error in its tooltip
      // instead of throwing.
      throwOnError: false,
      // A bare `\\` is a no-op in LaTeX display math, and KaTeX warns on every
      // render that it breaks the line anyway. Breaking it is what people mean.
      strict: 'ignore',
      // `trust` stays off, which keeps links, images and raw HTML classes out;
      // and a size given in the TeX (`\rule{500em}{500em}`) is capped at 50em.
      maxSize: 50,
      // Fresh per render: KaTeX writes into this object.
      macros: Object.fromEntries(DEFINERS.map((name) => [name, () => {
        throw new k.ParseError(`${name} is off: a shared note cannot define macros`);
      }])),
    });
  } catch {
    // Not a parse error (those are rendered, above) — leave the source up.
    el.textContent = tex;
  }
}

/**
 * A `$$ … $$` block or `$ … $` in the text, typeset. Replaces the block while the cursor is elsewhere,
 * like a table; `buildMath` leaves the source as soon as the selection touches
 * it.
 */
export class MathWidget extends WidgetType {
  readonly tex: string;
  // Display math (`$$`), on a row of its own, or inline math (`$`) in the text.
  readonly display: boolean;

  constructor(tex: string, display = true) {
    super();
    this.tex = tex;
    this.display = display;
  }

  override eq(other: MathWidget): boolean {
    return other.tex === this.tex && other.display === this.display;
  }

  override toDOM(view: EditorView): HTMLElement {
    const el: HTMLElement = document.createElement(this.display ? 'div' : 'span');
    el.className = this.display ? 'md-math' : 'md-math-inline';
    // TeX lays itself out left to right, whatever the text around it reads in.
    el.dir = 'ltr';
    // A widget swallows its events, so a tap would never reach the source —
    // and a phone has no arrow key to get there instead. Asked of the DOM, not
    // remembered from when it was built: text typed above moves the block, and
    // an equal widget keeps this element.
    el.addEventListener('mousedown', (event) => {
      // Not on the scrollbar of a formula too wide for the line: that scrolls.
      if (this.display && event.target === el && event.offsetY >= el.clientHeight) return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: view.posAtDOM(el) } });
    });
    if (katex) {
      render(katex, el, this.tex, this.display);
    } else {
      el.textContent = this.tex;
      loadKatex().then((k) => {
        render(k, el, this.tex, this.display);
        // The block just changed height under CodeMirror's feet.
        if (el.isConnected) view.requestMeasure();
      }, () => { /* the source stays up */ });
    }
    return el;
  }
}
