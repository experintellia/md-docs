import { type EditorView, WidgetType } from '@codemirror/view';
import { jumpToFootnote } from './footnote.ts';
import { MAX_TEX, mathCost, typeset } from './math.ts';

/** A run of cell text, carrying the class the live preview paints it with. */
export interface Segment {
  text: string;
  cls?: string;
  /** Set on a link; the widget opens it rather than showing its source. */
  href?: string;
  /** Set on math (`$x$`, `$$x$$`): the TeX, typeset in place of `text`. */
  math?: { tex: string; display: boolean };
  /** Set on a footnote reference: what a tap on it follows (see jumpToFootnote). */
  fn?: { label: string | null; n: number | null };
}

export interface TableSpec {
  /** Where the table starts, so a tap can put the caret in its source. */
  from: number;
  /** Header cells, then one array of cells per body row. */
  header: Segment[][];
  rows: Segment[][][];
  /** Per column, from the delimiter row: `:---`, `:---:`, `---:`. */
  align: (('start' | 'center' | 'end') | null)[];
  dir: 'ltr' | 'rtl' | null;
  /** The markdown this was built from — the widget's identity. */
  source: string;
  /** The footnote numbers its cells show in read mode, which the source alone
   *  does not decide: a reference above the table renumbers them. */
  notes?: string;
}

/**
 * A markdown table, rendered. Replaces the block while the cursor is elsewhere;
 * `buildDecorations` leaves the source alone as soon as the selection touches
 * it, which is how the rest of the live preview behaves.
 *
 * The columns are aligned by the table element, so the source no longer has to
 * be padded by hand to stay readable.
 */
export class TableWidget extends WidgetType {
  readonly spec: TableSpec;

  constructor(spec: TableSpec) {
    super();
    this.spec = spec;
  }

  override eq(other: TableWidget): boolean {
    return other.spec.source === this.spec.source && other.spec.dir === this.spec.dir
      && other.spec.notes === this.spec.notes;
  }

  override toDOM(view: EditorView): HTMLElement {
    const { header, rows, align, dir } = this.spec;
    // The table is wrapped, and the wrapper carries the direction. A table's
    // own `dir` mirrors its columns but not its box: the box is placed by its
    // parent, and .cm-content reads left-to-right, so an Arabic table would
    // hug the left edge with its columns reversed inside. A flex wrapper in
    // the table's own direction starts it from the edge the table reads from.
    const wrap = document.createElement('div');
    wrap.className = 'md-table-wrap';
    if (dir) wrap.setAttribute('dir', dir);
    // A widget swallows its events, so a tap would leave the caret where it
    // was and the table would never open. On a phone there is no arrow key to
    // fall back on, so put the caret in the source here — except on a link,
    // which has its own job.
    wrap.addEventListener('mousedown', (event) => {
      const target = event.target as Element | null;
      if (target?.closest('a')) return;
      const ref = target?.closest<HTMLElement>('[data-fn-n], [data-fn-label]');
      if (ref) {
        const n = ref.dataset.fnN === undefined ? null : Number(ref.dataset.fnN);
        if (jumpToFootnote(view, ref.dataset.fnLabel ?? null, n)) {
          event.preventDefault();
          return;
        }
      }
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.spec.from } });
    });

    const table = wrap.appendChild(document.createElement('table'));
    table.className = 'md-table';

    // MAX_TEX bounds one formula; this bounds the table's, all drawn at once.
    // Past it, the rest of its math stays source.
    const budget = { left: MAX_TEX };
    const head = table.appendChild(document.createElement('thead'));
    head.appendChild(this.row(view, budget, header, align, 'th'));
    const body = table.appendChild(document.createElement('tbody'));
    for (const row of rows) body.appendChild(this.row(view, budget, row, align, 'td'));
    return wrap;
  }

  private row(
    view: EditorView, budget: { left: number }, cells: Segment[][], align: TableSpec['align'], tag: 'th' | 'td',
  ): HTMLElement {
    const tr = document.createElement('tr');
    cells.forEach((segments, column) => {
      const cell = tr.appendChild(document.createElement(tag));
      // Logical, so a right-to-left table's "start" is its right-hand edge.
      if (align[column]) cell.style.textAlign = align[column]!;
      for (const segment of segments) cell.append(segmentNode(segment, view, budget));
    });
    return tr;
  }
}

/** A segment as the DOM shows it, in a table cell or the footnote list. */
export function segmentNode(segment: Segment, view: EditorView, budget: { left: number }): Node {
  if (segment.math && mathCost(segment.math.tex) <= budget.left) {
    budget.left -= mathCost(segment.math.tex);
    const { tex, display } = segment.math;
    const el = document.createElement(display ? 'div' : 'span');
    el.className = display ? 'md-math' : 'md-math-inline';
    el.dir = 'ltr';
    typeset(view, el, tex, display);
    return el;
  }
  if (segment.href === undefined && segment.cls === undefined) {
    return document.createTextNode(segment.text);
  }
  const el = document.createElement(segment.href !== undefined ? 'a' : segment.fn ? 'sup' : 'span');
  el.className = segment.cls ?? '';
  el.textContent = segment.text;
  if (segment.fn?.label != null) el.dataset.fnLabel = segment.fn.label;
  if (segment.fn?.n != null) el.dataset.fnN = String(segment.fn.n);
  if (segment.href !== undefined) {
    // A real href, so the link is focusable and a screen reader announces it.
    (el as HTMLAnchorElement).href = segment.href;
    // The editor is contenteditable: a press would put the caret in the widget
    // instead of following the link, so open it here as the live preview does
    // for a link in ordinary text.
    el.addEventListener('mousedown', (event) => { event.preventDefault(); });
    el.addEventListener('click', () => { window.open(segment.href, '_blank'); });
  }
  return el;
}
