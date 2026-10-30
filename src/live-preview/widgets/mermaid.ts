import { type EditorView, WidgetType } from '@codemirror/view';

type Drawn = { svg: string } | { error: string };

// Past this a diagram is given up on and its worker killed. Pele draws a
// typical diagram in milliseconds. A fresh worker gets longer: it first loads
// and compiles 700 KB of script, which a slow phone may take seconds over.
const TIMEOUT = 5000;
const FIRST_TIMEOUT = 15000;

// ponytail: Pele (Obsidian's Mermaid renderer) runs in a worker that starts
// with the first diagram a document shows, as KaTeX loads with the first
// formula. Until a diagram is drawn its block shows the source.
let worker: Worker | undefined;
// One diagram at a time, so a timeout kills only the one that ran over.
let queue: Promise<unknown> = Promise.resolve();

function drawInWorker(source: string): Promise<Drawn> {
  const drawn = queue.then(() => new Promise<Drawn>((resolve) => {
    const fresh = !worker;
    let w: Worker;
    try {
      w = worker ??= new Worker(new URL('./mermaid-worker.ts', import.meta.url));
    } catch {
      // A host that refuses workers: no diagrams, but nothing else stuck.
      resolve({ error: 'Could not draw this diagram' });
      return;
    }
    const fail = (error: string) => {
      w.terminate();
      worker = undefined;
      resolve({ error });
    };
    const timer = setTimeout(() => fail('Took too long to draw'), fresh ? FIRST_TIMEOUT : TIMEOUT);
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

// A block is redrawn each time it comes back into view: the cursor leaves it,
// it scrolls back in, the document is reopened. Without this each would show
// its source until the worker answered, and a diagram that timed out would
// hold every other one up for another five seconds.
//
// ponytail: the last 50 sources, results kept whole. A note with more
// diagrams than that redraws some of them; raise it if one does.
const CACHE = 50;
const drawn = new Map<string, Promise<Drawn>>();
const settled = new Map<string, Drawn>();

function draw(source: string): Promise<Drawn> {
  let result = drawn.get(source);
  if (!result) {
    result = drawInWorker(source).then((d) => {
      if (drawn.has(source)) settled.set(source, d);
      return d;
    });
    drawn.set(source, result);
    if (drawn.size > CACHE) {
      const oldest = drawn.keys().next().value!;
      drawn.delete(oldest);
      settled.delete(oldest);
    }
  }
  return result;
}

function show(el: HTMLElement, d: Drawn): void {
  if ('svg' in d) {
    // Pele escapes the diagram's text and filters its styles and links,
    // and the worker supplies no icon or math markup, which it would not
    // filter. See https://pele.run/security.
    el.innerHTML = d.svg;
  } else {
    // Half-typed, unsupported or too big: the source stays up, the reason
    // under it — not in a tooltip, which a phone cannot hover. As text:
    // the message can quote the diagram.
    el.classList.add('md-mermaid-error');
    el.appendChild(document.createElement('div')).textContent = d.error;
  }
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
      // Not on the scrollbar of a diagram or error too wide for the line.
      const scrollbar = el.scrollWidth > el.clientWidth && event.offsetY >= el.clientHeight;
      if (event.target === el && scrollbar) return;
      event.preventDefault();
      view.focus();
      view.dispatch({ selection: { anchor: view.posAtDOM(el) } });
    });
    el.textContent = this.source;
    const known = settled.get(this.source);
    if (known) {
      // Drawn before: at once, so the block keeps its height.
      show(el, known);
      return el;
    }
    void draw(this.source).then((d) => {
      show(el, d);
      // It just changed size under CodeMirror's feet.
      if (el.isConnected) view.requestMeasure();
    });
    return el;
  }
}
