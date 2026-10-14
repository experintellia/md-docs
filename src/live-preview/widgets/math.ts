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

// What a formula counts against a paragraph's or a table's MAX_TEX: its TeX,
// and a widget's worth of DOM. 10,000 `$a$` were 72,000 nodes and 4 s a
// keystroke, though only 10,000 characters of TeX.
export const mathCost = (tex: string): number => tex.length + 50;

// Past this, nesting is the cost: `\cancel{` 500 deep is 4.5 KB and took four
// seconds to lay out in Chromium, and `\begin{array}` 160 deep crashed its
// renderer. Groups are what nest: braces, `\left`, environments, `\bgroup`.
// A command given no group as its argument errors out at once instead.
export const MAX_DEPTH = 50;

const OPENS = new Set(['{', '\\left', '\\begin', '\\bgroup', '\\begingroup']);
const CLOSES = new Set(['}', '\\right', '\\end', '\\egroup', '\\endgroup']);

function depth(tex: string): number {
  let deepest = 0;
  let at = 0;
  // A command (`\left`, not `\leftarrow`), an escaped character (`\{` is no
  // group), or a brace.
  for (const [token] of tex.matchAll(/\\[a-zA-Z]+|\\.|[{}]/g)) {
    if (OPENS.has(token)) at++;
    else if (CLOSES.has(token)) at--;
    deepest = Math.max(deepest, at);
  }
  return deepest;
}

export function render(k: Katex, el: HTMLElement, tex: string, displayMode = true): void {
  if (tex.length > MAX_TEX) {
    el.textContent = tex;
    el.title = `Too long to typeset (over ${MAX_TEX} characters)`;
    return;
  }
  if (depth(tex) > MAX_DEPTH) {
    el.textContent = tex;
    el.title = `Nested too deeply to typeset (over ${MAX_DEPTH} levels)`;
    return;
  }
  // Into a detached element first: what is too deep is caught before any
  // layout, which is where the cost is.
  const out = document.createElement('span');
  try {
    k.render(tex, out, {
      displayMode,
      // Half-typed TeX renders as red source with the error in its tooltip
      // instead of throwing.
      throwOnError: false,
      // A bare `\\` is a no-op in LaTeX display math, and KaTeX warns on every
      // render that it breaks the line anyway. Breaking it is what people mean.
      strict: 'ignore',
      // `trust` stays off, which keeps links, images and raw HTML classes out;
      // and a size given in the TeX (`\rule{500em}{500em}`) is capped at 50em.
      // A negative one is not: the stylesheet caps the formula's height.
      maxSize: 50,
      // Fresh per render: KaTeX writes into this object.
      macros: Object.fromEntries(DEFINERS.map((name) => [name, () => {
        throw new k.ParseError(`${name} is off: a shared note cannot define macros`);
      }])),
    });
  } catch {
    // Not a parse error (those are rendered, above) — leave the source up.
    el.textContent = tex;
    return;
  }
  const html = out.querySelector('.katex-html');
  const mathml = out.querySelector('.katex-mathml');
  if ((html && treeDepth(html) > MAX_HTML_DEPTH) || (mathml && treeDepth(mathml) > MAX_MATHML_DEPTH)) {
    el.textContent = tex;
    el.title = 'Nested too deeply to typeset';
    return;
  }
  el.replaceChildren(...out.childNodes);
}

// What KaTeX builds can nest deeper than the TeX shows: each `\color` or
// `\displaystyle` opens a group to the end of its own, without a brace, and
// 900 of them froze Chromium's layout for 22 s. Formulas within MAX_DEPTH reach
// about 360 (HTML) and 55 (MathML); `\color` 300 deep, 0.9 s, reaches 304.
const MAX_HTML_DEPTH = 400;
const MAX_MATHML_DEPTH = 160;

function treeDepth(el: Element): number {
  let deepest = 0;
  for (const child of el.children) deepest = Math.max(deepest, treeDepth(child));
  return deepest + 1;
}

/**
 * A `$$ … $$` block or `$ … $` in the text, typeset. Replaces the source
 * while the cursor is elsewhere, like a table; `buildMath` leaves the source as
 * soon as the selection touches it.
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
      // Math in a link's text is the link too.
      const href = el.closest<HTMLElement>('.md-link[data-href]')?.dataset.href;
      if (href) {
        event.preventDefault();
        window.open(href, '_blank');
        return;
      }
      // Read mode reveals no source, so a tap has nothing to open.
      if (view.state.readOnly) return;
      // Not on the scrollbar of a formula too wide for the line: that scrolls.
      // Inline ones have one too, since they scroll rather than widen a phone.
      const scrollbar = el.scrollWidth > el.clientWidth && event.offsetY >= el.clientHeight;
      if (event.target === el && scrollbar) return;
      event.preventDefault();
      // preventDefault also kept the focus away, and the keyboard closed on a
      // phone. Before the dispatch: after it this element is gone, and Chrome
      // ignores the focus.
      view.focus();
      view.dispatch({ selection: { anchor: view.posAtDOM(el) } });
    });
    typeset(view, el, this.tex, this.display);
    return el;
  }
}

/** Typeset `tex` into `el`, now if KaTeX is loaded, else once it is. */
export function typeset(view: EditorView, el: HTMLElement, tex: string, display: boolean): void {
  if (katex) {
    render(katex, el, tex, display);
    return;
  }
  el.textContent = tex;
  loadKatex().then((k) => {
    render(k, el, tex, display);
    // It just changed size under CodeMirror's feet.
    if (el.isConnected) view.requestMeasure();
  }, () => { /* the source stays up */ });
}
