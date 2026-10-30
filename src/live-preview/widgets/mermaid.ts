import { type EditorView, WidgetType } from '@codemirror/view';

type Pele = typeof import('pele/lazy');

// ponytail: Pele (Obsidian's Mermaid renderer) loads the first time a document
// actually shows a diagram, as KaTeX does, and `pele/lazy` then loads only the
// diagram types the document uses. Until then the block shows its source.
let pele: Pele | undefined;
let loading: Promise<Pele> | undefined;
function loadPele(): Promise<Pele> {
  return loading ??= import('pele/lazy').then((m) => (pele = m));
}

/**
 * A ```mermaid fence, drawn. Replaces the block while the cursor is elsewhere,
 * like a table or a `$$` block; `buildMermaid` leaves the source as soon as the
 * selection touches it.
 */
export class MermaidWidget extends WidgetType {
  readonly source: string;

  constructor(source: string) {
    super();
    this.source = source;
  }

  override eq(other: MermaidWidget): boolean {
    return other.source === this.source;
  }

  override toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('div');
    el.className = 'md-mermaid';
    el.dir = 'ltr';
    // A widget swallows its events, and a phone has no arrow key to reach the
    // source instead: a tap opens it, as on a `$$` block.
    el.addEventListener('mousedown', (event) => {
      if (view.state.readOnly) return;
      event.preventDefault();
      view.focus();
      view.dispatch({ selection: { anchor: view.posAtDOM(el) } });
    });
    el.textContent = this.source;
    const draw = (p: Pele) => p.renderAsync(this.source, {
      // The editor is contenteditable, and a tap opens the source: a link in
      // the diagram could not be followed anyway.
      links: false,
    }).then(({ svg }) => {
      // Pele escapes the diagram's text and filters its styles; see
      // https://pele.run/security.
      el.innerHTML = svg;
      el.classList.remove('md-mermaid-error');
    }, (error: unknown) => {
      // Half-typed or unsupported: the source stays up, the reason in its
      // tooltip.
      el.classList.add('md-mermaid-error');
      el.title = error instanceof Error ? error.message : String(error);
    }).then(() => {
      // It just changed size under CodeMirror's feet.
      if (el.isConnected) view.requestMeasure();
    });
    if (pele) void draw(pele);
    else loadPele().then(draw, () => { /* the source stays up */ });
    return el;
  }
}
