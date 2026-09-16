import { WidgetType } from '@codemirror/view';

/** A run of cell text, carrying the class the live preview paints it with. */
export interface Segment {
  text: string;
  cls?: string;
  /** Set on a link; the widget opens it rather than showing its source. */
  href?: string;
}

export interface TableSpec {
  /** Header cells, then one array of cells per body row. */
  header: Segment[][];
  rows: Segment[][][];
  /** Per column, from the delimiter row: `:---`, `:---:`, `---:`. */
  align: (('start' | 'center' | 'end') | null)[];
  dir: 'ltr' | 'rtl' | null;
  /** The markdown this was built from — the widget's identity. */
  source: string;
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
    return other.spec.source === this.spec.source && other.spec.dir === this.spec.dir;
  }

  override toDOM(): HTMLElement {
    const { header, rows, align, dir } = this.spec;
    // The table is wrapped, and the wrapper carries the direction. A table's
    // own `dir` mirrors its columns but not its box: the box is placed by its
    // parent, and .cm-content reads left-to-right, so an Arabic table would
    // hug the left edge with its columns reversed inside. A flex wrapper in
    // the table's own direction starts it from the edge the table reads from.
    const wrap = document.createElement('div');
    wrap.className = 'md-table-wrap';
    if (dir) wrap.setAttribute('dir', dir);

    const table = wrap.appendChild(document.createElement('table'));
    table.className = 'md-table';

    const head = table.appendChild(document.createElement('thead'));
    head.appendChild(this.row(header, align, 'th'));
    const body = table.appendChild(document.createElement('tbody'));
    for (const row of rows) body.appendChild(this.row(row, align, 'td'));
    return wrap;
  }

  private row(cells: Segment[][], align: TableSpec['align'], tag: 'th' | 'td'): HTMLElement {
    const tr = document.createElement('tr');
    cells.forEach((segments, column) => {
      const cell = tr.appendChild(document.createElement(tag));
      // Logical, so a right-to-left table's "start" is its right-hand edge.
      if (align[column]) cell.style.textAlign = align[column]!;
      for (const segment of segments) cell.append(node(segment));
    });
    return tr;
  }
}

function node(segment: Segment): Node {
  if (segment.href === undefined && segment.cls === undefined) {
    return document.createTextNode(segment.text);
  }
  const el = document.createElement(segment.href === undefined ? 'span' : 'a');
  el.className = segment.cls ?? '';
  el.textContent = segment.text;
  if (segment.href !== undefined) {
    // The editor is contenteditable: a press would put the caret in the widget
    // instead of following the link, so open it here as the live preview does
    // for a link in ordinary text.
    el.addEventListener('mousedown', (event) => { event.preventDefault(); });
    el.addEventListener('click', () => { window.open(segment.href, '_blank'); });
  }
  return el;
}
