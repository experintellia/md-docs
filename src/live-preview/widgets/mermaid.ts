import { type EditorView, WidgetType } from '@codemirror/view';

type Drawn = { svg: string } | { error: string };

// Past this a diagram is given up on and its worker killed. Pele draws a
// typical diagram in milliseconds; this leaves room for loading the worker on a
// slow phone.
const TIMEOUT = 5000;

// ponytail: Pele (Obsidian's Mermaid renderer) runs in a worker that starts
// with the first diagram a document shows, as KaTeX loads with the first
// formula. Until a diagram is drawn its block shows the source.
let worker: Worker | undefined;
// One diagram at a time, so a timeout kills only the one that ran over.
let queue: Promise<unknown> = Promise.resolve();

function draw(source: string): Promise<Drawn> {
  const drawn = queue.then(() => new Promise<Drawn>((resolve) => {
    const w = worker ??= new Worker(new URL('./mermaid-worker.ts', import.meta.url));
    const fail = (error: string) => {
      w.terminate();
      worker = undefined;
      resolve({ error });
    };
    const timer = setTimeout(() => fail('Took too long to draw'), TIMEOUT);
    w.onmessage = ({ data }: MessageEvent<Drawn>) => {
      clearTimeout(timer);
      resolve(data);
    };
    w.onerror = () => {
      clearTimeout(timer);
      fail('Could not draw this diagram');
    };
    w.postMessage(source);
  }));
  queue = drawn;
  return drawn;
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
    void draw(this.source).then((drawn) => {
      if ('svg' in drawn) {
        // Pele escapes the diagram's text and filters its styles and links,
        // and the worker supplies no icon or math markup, which it would not
        // filter. See https://pele.run/security.
        el.innerHTML = drawn.svg;
      } else {
        // Half-typed, unsupported or too big: the source stays up, the reason
        // under it — not in a tooltip, which a phone cannot hover. As text:
        // the message can quote the diagram.
        el.classList.add('md-mermaid-error');
        el.appendChild(document.createElement('div')).textContent = drawn.error;
      }
      // It just changed size under CodeMirror's feet.
      if (el.isConnected) view.requestMeasure();
    });
    return el;
  }
}
