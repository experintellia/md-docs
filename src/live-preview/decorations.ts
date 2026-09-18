import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Line, type Range, StateField, type Text } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { BulletWidget } from './widgets/bullet.ts';
import { CheckboxWidget } from './widgets/checkbox.ts';
import { CopyButtonWidget } from './widgets/copy-button.ts';
import { type Segment, type TableSpec, TableWidget } from './widgets/table.ts';

/**
 * Obsidian-style "reveal on cursor": markdown syntax markers are hidden unless
 * the cursor / selection touches the same line, in which case the raw markup is
 * shown so it can be edited. Reveal is per-line (not per-node).
 */
function lineHasSelection(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  return state.selection.ranges.some(
    (r) => r.from <= line.to && r.to >= line.from,
  );
}

// Inline nodes whose whole range gets a styling class.
const INLINE_MARK_CLASS: Record<string, string> = {
  StrongEmphasis: 'md-strong',
  Emphasis: 'md-emphasis',
  InlineCode: 'md-inline-code',
  Strikethrough: 'md-strike',
};

// Syntax-marker nodes that get hidden (unless revealed on the active line).
const HIDDEN_MARKS = new Set([
  'EmphasisMark',
  'CodeMark',
  'StrikethroughMark',
  'HeaderMark',
  'QuoteMark',
  'LinkMark',
  // `[text](url "the title")` — the title belongs to the destination, so it is
  // hidden with it rather than leaking into the rendered text.
  'LinkTitle',
]);

const hidden = Decoration.replace({});

// A character decides a line's direction only if it is a letter or one of the
// explicit direction marks. Digits and punctuation do not — and `\p{Script=…}`
// alone would not know that: `\p{Script=Arabic}` also covers the Arabic-Indic
// digits and the Arabic percent sign, which would turn `٢٠٢٤ report` into an
// RTL line.
const DECIDES = /[\p{L}\u200e\u200f\u061c]/u;
// RLM and ALM state the direction outright; the rest are the RTL scripts a note
// might plausibly be written in.
//
// ponytail: living scripts only. Unicode has two dozen more RTL scripts —
// Phoenician, Avestan, Old Turkic — and adding them costs a longer regex for
// text nobody is taking notes in.
// Leading block syntax is not content. The `x` in `- [x]` is a letter and would
// decide the line before its text did, so ticking a task in an Arabic list
// turned the whole item around — and unticking it turned it back.
const BLOCK_MARKERS = /^[\s>]*(?:[-*+]|\d+[.)])?\s*(?:\[[ xX]\])?\s*/;
const RTL = /[\u200f\u061c\p{Script=Adlam}\p{Script=Arabic}\p{Script=Hanifi_Rohingya}\p{Script=Hebrew}\p{Script=Mandaic}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Syriac}\p{Script=Thaana}]/u;

// Is this line inside a code block? Code is pinned left-to-right whatever it
// contains, so it cannot speak for the block around it.
function isCode(state: EditorState, line: Line): boolean {
  for (let n = syntaxTree(state).resolveInner(line.to, -1); ; n = n.parent) {
    if (n.name === 'FencedCode' || n.name === 'CodeBlock') return true;
    if (!n.parent) return false;
  }
}

/**
 * The direction a block reads in: the first of its lines that decides one,
 * skipping the ones inside code. A quote opening with a fenced block would
 * otherwise take its direction from `const x = 1`, and draw its bar on the far
 * side of the Arabic prose below it.
 *
 * Scanned line by line rather than over one slice of the whole block — a table
 * or an indented block thousands of lines long would be copied out and scanned
 * end to end on every rebuild, and rebuilds happen on every caret move.
 *
 * ponytail: it gives up after 200 lines. A block that has said nothing by then
 * is a wall of digits, and scanning it per undecided line is quadratic; the
 * answer is on the first line in anything anyone writes.
 */
function blockDirection(state: EditorState, from: number, to: number): 'ltr' | 'rtl' | null {
  const doc = state.doc;
  for (let pos = from, seen = 0; pos <= to && seen < 200; seen++) {
    const line = doc.lineAt(pos);
    if (!isCode(state, line)) {
      const dir = lineDirection(line.text);
      if (dir) return dir;
    }
    pos = line.to + 1;
  }
  return null;
}

export function lineDirection(text: string): 'ltr' | 'rtl' | null {
  for (const ch of text.replace(BLOCK_MARKERS, '')) {
    if (DECIDES.test(ch)) return RTL.test(ch) ? 'rtl' : 'ltr';
  }
  return null;
}

// Where a block overrules its lines. Code is always left-to-right, or a comment
// opening in Arabic turns the line around. A table reads one way throughout, or
// a mixed row reverses its pipes and slides its cells under the wrong headers.
// A quote or list decides only for a line with no letters of its own — a bare
// `>` between paragraphs, the `- ` of an item just opened — so the line does
// not sit at the far edge and jump across on the first keystroke.
//
// A code block inside a right-to-left quote therefore holds lines of two
// directions. The quote bar copes with that — its side comes from the quote,
// not from the line (see the md-quote-ltr / md-quote-rtl classes above).
function directionAt(state: EditorState, line: Line): 'ltr' | 'rtl' | null {
  let own = lineDirection(line.text);
  // Resolved at the line's end, not its start: an indented code block begins
  // after the indent, so the first column is not inside it.
  for (let n = syntaxTree(state).resolveInner(line.to, -1); ; n = n.parent) {
    if (n.name === 'FencedCode' || n.name === 'CodeBlock') return 'ltr';
    if (n.name === 'Table') return blockDirection(state, n.from, n.to);
    if (!own && /^(?:Blockquote|BulletList|OrderedList)$/.test(n.name)) {
      own = blockDirection(state, n.from, n.to);
    }
    if (!n.parent) return own;
  }
  return own;
}

// One direction per line, not one per document: a note can mix an Arabic
// paragraph with an English one. It sits on the line, not on the inline spans —
// per span, a line like `**عربي** text` would be judged in fragments and lay
// itself out in pieces. CodeMirror only reads direction per line when
// `perLineTextDirection` is on (see ./index.ts); without that facet the text
// would look right while the caret still moved as if everything were LTR.
const dirDeco = {
  ltr: Decoration.line({ attributes: { dir: 'ltr' } }),
  rtl: Decoration.line({ attributes: { dir: 'rtl' } }),
};

// The lezer node type, read off the API instead of imported: `@lezer/common` is
// a transitive dependency here, not one this package declares.
type SyntaxNodeLike = ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>;

// Does the selection touch anything between `from` and `to`? Blocks reveal
// their source on the same rule single lines do, just over a range.
function rangeHasSelection(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

// Which URL node is a link's *destination*? Not simply "a URL inside a Link":
// GFM parses autolink-shaped link TEXT into a URL node too, so
// `[www.a.com](https://b.com)` contains two of them. Treating both as the
// destination hid the text as well and the link vanished from the preview
// entirely — blank in a table cell, invisible inline. The destination is the
// one introduced by the `](`.
function isLinkDestination(node: SyntaxNodeLike, doc: Text): boolean {
  const parent = node.parent?.name;
  if (parent !== 'Link' && parent !== 'Image') return false;
  const prev = node.prevSibling;
  return prev?.name === 'LinkMark' && doc.sliceString(prev.from, prev.to) === '(';
}

// `[a][ref]` carries its reference in a LinkLabel, which is syntax and should
// not be read out. The same node also names a definition line (`[a]: url`),
// where it IS the content, so only the one inside a Link is hidden.
function isReferenceLabel(node: SyntaxNodeLike): boolean {
  return node.name === 'LinkLabel' && node.parent?.name === 'Link';
}

// The `:` of a link-reference definition (`[a]: url`) is a LinkMark like any
// other, but hiding it turns the line into `[a] url` — silently changing what
// it appears to say. A definition is metadata with no rendered form, so it is
// left readable as source instead.
function isDefinitionColon(node: SyntaxNodeLike): boolean {
  return node.name === 'LinkMark' && node.parent?.name === 'LinkReference';
}

// A cell's text, split where the live preview would paint it differently. The
// markers that produce the formatting are dropped, the rest keeps the same
// `md-*` classes the editor uses everywhere else.
function cellSegments(cell: SyntaxNodeLike, doc: Text, cls?: string): Segment[] {
  const out: Segment[] = [];
  let pos = cell.from;
  for (let child = cell.firstChild; child; child = child.nextSibling) {
    if (child.from > pos) out.push({ text: doc.sliceString(pos, child.from), cls });
    pos = child.to;
    if (HIDDEN_MARKS.has(child.name) && !isDefinitionColon(child)) continue;
    if (isReferenceLabel(child)) continue;
    if (child.name === 'URL') {
      const text = doc.sliceString(child.from, child.to);
      if (child.parent?.name === 'Link' || child.parent?.name === 'Image') {
        // The destination is redundant with the link text we already emit, so
        // it stays dropped; autolink-shaped link *text* is that text and has to
        // survive. The enclosing Link supplies the href either way.
        if (isLinkDestination(child, doc)) continue;
        out.push({ text, cls });
        continue;
      }
      // A bare autolink has no link text — it IS the visible link. Skipping it
      // rendered the whole cell empty while the source clearly had content.
      out.push({ text, cls: 'md-link', href: safeHref(text) ?? undefined });
      continue;
    }
    if (child.name === 'Escape') {
      // `\|` is the only way to put a pipe in a cell; show the pipe, not both.
      out.push({ text: doc.sliceString(child.from + 1, child.to), cls });
      continue;
    }
    if (child.name === 'Link') {
      const url = linkDestination(child, doc);
      const text = cellSegments(child, doc, cls).map((s) => s.text).join('');
      out.push({ text, cls: 'md-link', href: safeHref(url ?? '') ?? undefined });
      continue;
    }
    out.push(...cellSegments(child, doc, INLINE_MARK_CLASS[child.name] ?? cls));
  }
  if (pos < cell.to) out.push({ text: doc.sliceString(pos, cell.to), cls });
  return out.filter((s) => s.text !== '' || s.href !== undefined);
}

// A row's cells, empty ones included. The parser emits a TableCell only where
// there is content, so `| 1 |   | 3 |` would arrive as two cells and slide `3`
// under the second column — silent, and invisible in a view that hides the
// source. The pipes are the truth, so the cells are read between them.
function rowCells(row: SyntaxNodeLike, doc: Text): Segment[][] {
  const cells: Segment[][] = [];
  let openedAt: number | null = null;
  for (let child = row.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableCell') {
      cells.push(cellSegments(child, doc));
      openedAt = null;
      continue;
    }
    if (child.name !== 'TableDelimiter') continue;
    // Two pipes with nothing but space between them: an empty cell.
    if (openedAt !== null && doc.sliceString(openedAt, child.from).trim() === '') {
      cells.push([]);
    }
    openedAt = child.to;
  }
  return cells;
}

// `|:---|---:|:---:|` -> one alignment per column.
function columnAlignment(row: string): TableSpec['align'] {
  return row
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((spec) => {
      const left = spec.trim().startsWith(':');
      const right = spec.trim().endsWith(':');
      if (left && right) return 'center' as const;
      if (right) return 'end' as const;
      if (left) return 'start' as const;
      return null;
    });
}

function headingClass(name: string): string | null {
  const m = /^ATXHeading(\d)$/.exec(name);
  return m ? `md-h${m[1]}` : null;
}

// Pull the destination out of a `[text](url)` / `[text](url "title")` source.
function linkDestination(link: SyntaxNodeLike, doc: Text): string | null {
  // Direct children only: in `[![alt](img)](href)` the image's own URL is a
  // grandchild, so it is skipped for free. Reading the first `](` out of the
  // source text instead is what made a badge link resolve to its badge image.
  for (let child = link.firstChild; child; child = child.nextSibling) {
    if (child.name === 'URL' && isLinkDestination(child, doc)) {
      const url = doc.sliceString(child.from, child.to);
      // `[text](<url>)` — the angle brackets delimit the destination (the only
      // way to write one containing spaces) and are not part of it. Left on,
      // `<` is not a scheme, so safeHref rejected it and the link went dead.
      return url.startsWith('<') && url.endsWith('>') ? url.slice(1, -1) : url;
    }
  }
  return null;
}

// Turn a link destination into an href we are willing to hand to window.open,
// or null to leave it unclickable. The document is shared over chat, so the
// destination is peer-controlled: a `[click me](javascript:...)` planted by
// another peer must never reach window.open. Only http(s) and mailto pass.
// A scheme-less autolink gets the scheme it implies — `www.foo` is a host,
// `a@b.com` is an email (`https://mailto:a@b.com` was the old bug).
function safeHref(url: string): string | null {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (scheme) return /^(https?|mailto)$/i.test(scheme[1]) ? url : null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url)) return `mailto:${url}`;
  // Anything else scheme-less (`/foo`, `#anchor`, '') is not openable here.
  return /^[\w-]+(\.[\w-]+)+/.test(url) ? `https://${url}` : null;
}

/**
 * Open a previewed link on click. The link is a styled span (not a real anchor,
 * which contenteditable would swallow), so we open its data-href ourselves.
 * webxdc runs sandboxed: the messenger handles `window.open` for http(s),
 * routing to the system browser.
 */
export const linkClickHandler = EditorView.domEventHandlers({
  mousedown(event) {
    const target = event.target as HTMLElement | null;
    const href = target?.closest<HTMLElement>('.md-link[data-href]')?.dataset.href;
    if (!href) return false;
    event.preventDefault();
    window.open(href, '_blank');
    return true;
  },
});

export function buildDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const buttoned = new Set<number>();
  const { state } = view;
  const doc = state.doc;

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;

        // --- Block-level: headings, blockquotes, fenced code -> line classes
        const hClass = headingClass(name);
        if (hClass) {
          const line = doc.lineAt(node.from);
          ranges.push(Decoration.line({ class: hClass }).range(line.from));
          return;
        }
        if (name === 'FencedCode') {
          // Copy button on the opening fence, carrying the block body only
          // (CodeText excludes the ``` fences and the info string).
          //
          // getChildren, not getChild: inside a blockquote or a list item the
          // body is split into one CodeText per line (the QuoteMarks and the
          // list indent interrupt it), so the first child alone would copy just
          // the first line. The pieces already carry their own line breaks, so
          // concatenating them keeps the body byte-for-byte -- including its
          // lack of a trailing newline.
          const body = node.node.getChildren('CodeText');
          const anchor = doc.lineAt(node.from).to;
          if (body.length > 0 && !buttoned.has(anchor)) {
            // A block can be entered once per visible range (CodeMirror splits
            // the viewport around very long lines), and two widgets at one
            // position would stack invisibly.
            buttoned.add(anchor);
            ranges.push(
              Decoration.widget({
                widget: new CopyButtonWidget(
                  body.map((part) => doc.sliceString(part.from, part.to)).join(''),
                ),
                side: 1,
              }).range(anchor),
            );
          }
        }
        if (name === 'Blockquote' || name === 'FencedCode') {
          // `- > text` parses as a ListItem directly containing a Blockquote
          // (valid CommonMark). Styling it as a quote too would double up
          // with the bullet on the same line, so a quote that *is* a list
          // item's content renders as plain list-item text instead.
          if (name === 'Blockquote' && node.node.parent?.name === 'ListItem') {
            return;
          }
          // The quote's bar belongs to the quote, not to the line. A quote can
          // hold lines of both directions — an English sentence among Arabic
          // ones, a code block that is always left-to-right — and a bar placed
          // by each line's own direction crosses to the other side in the
          // middle of the quote. So the side is stated once, from the quote's
          // direction, and every one of its lines carries it.
          //
          // A quote nested in one of the opposite direction therefore draws
          // both bars on its lines, which reads as a box around the inner
          // quote. Fine, and better than a spine that breaks.
          const cls = name === 'Blockquote'
            ? `md-quote md-quote-${blockDirection(state, node.from, node.to) ?? 'ltr'}`
            : 'md-code-block';
          let pos = node.from;
          while (pos <= node.to) {
            const line = doc.lineAt(pos);
            const isLast = line.to + 1 > node.to;
            // The block's background is painted per line, so the first and last
            // get tagged for the CSS to round the outer corners. A one-line
            // block gets both, which is why they set corners and not the
            // `border-radius` shorthand.
            const edges = name !== 'FencedCode' ? '' :
              (pos === node.from ? ' md-code-first' : '') + (isLast ? ' md-code-last' : '');
            ranges.push(Decoration.line({ class: cls + edges }).range(line.from));
            if (isLast) break;
            pos = line.to + 1;
          }
          return;
        }

        // --- Thematic break (`---`, any length): draw the rule with a line
        //     class and hide the markers. The parser already rejects the
        //     near-misses (2 markers, trailing text, `---` under text is a
        //     setext heading, anything inside a code fence). It also accepts
        //     `***` / `___`, which we deliberately leave as plain text.
        if (name === 'HorizontalRule') {
          if (!/^[-\s]+$/.test(doc.sliceString(node.from, node.to))) return;
          const line = doc.lineAt(node.from);
          ranges.push(Decoration.line({ class: 'md-hr' }).range(line.from));
          if (!lineHasSelection(state, node.from)) {
            ranges.push(hidden.range(node.from, node.to));
          }
          return;
        }

        // --- Inline emphasis / code styling
        const inlineClass = INLINE_MARK_CLASS[name];
        if (inlineClass) {
          ranges.push(
            Decoration.mark({ class: inlineClass }).range(node.from, node.to),
          );
          return;
        }
        if (name === 'Link') {
          // In preview (markers hidden) the link text becomes clickable via a
          // data-href the click handler below opens; while editing the line we
          // leave it as plain styled text so the raw `[text](url)` stays editable.
          const url = lineHasSelection(state, node.from)
            ? null
            : safeHref(linkDestination(node.node, doc) ?? '');
          ranges.push(
            Decoration.mark({
              class: 'md-link',
              attributes: url ? { 'data-href': url } : undefined,
            }).range(node.from, node.to),
          );
          return;
        }
        if (name === 'URL') {
          // Inside a `[text](url)` link or `![alt](url)` image the URL is the
          // destination — redundant with the shown text/alt, so hide it (raw on
          // the active line). A standalone URL (bare autolink or `<url>`) is
          // itself the visible link, so style it like a link instead of hiding.
          const parent = node.node.parent?.name;
          if (parent === 'Link' || parent === 'Image') {
            // Only the destination is redundant. Autolink-shaped link text is
            // left alone: the enclosing Link already carries the class and the
            // data-href, so marking it again here would point a click at the
            // text instead of the real destination.
            if (isLinkDestination(node.node, doc) && !lineHasSelection(state, node.from)) {
              ranges.push(hidden.range(node.from, node.to));
            }
            return;
          }
          const url = lineHasSelection(state, node.from)
            ? null
            : safeHref(doc.sliceString(node.from, node.to));
          ranges.push(
            Decoration.mark({
              class: 'md-link',
              attributes: url ? { 'data-href': url } : undefined,
            }).range(node.from, node.to),
          );
          return;
        }

        // --- List bullets: task items render as just the checkbox (hide the
        //     bullet); plain bullets show a • glyph. Both reveal the raw marker
        //     on the active line. Ordered lists keep their number.
        if (name === 'ListMark') {
          const markText = doc.sliceString(node.from, node.to);
          if (!/^[-*+]$/.test(markText)) return;
          if (lineHasSelection(state, node.from)) return;
          let end = node.to;
          if (doc.sliceString(end, end + 1) === ' ') end++;
          const after = doc.sliceString(end, doc.lineAt(node.from).to);
          ranges.push(
            /^\[[ xX]\]/.test(after)
              ? hidden.range(node.from, end)
              : Decoration.replace({ widget: new BulletWidget() }).range(
                node.from,
                end,
              ),
          );
          return;
        }

        // --- Task checkbox widget (click toggles); reveals raw `[ ]` on the
        //     active line so the whole item reads as markdown when edited.
        if (name === 'TaskMarker') {
          if (lineHasSelection(state, node.from)) return;
          const text = doc.sliceString(node.from, node.to);
          const checked = /\[[xX]\]/.test(text);
          ranges.push(
            Decoration.replace({
              widget: new CheckboxWidget(checked, node.from, node.to),
            }).range(node.from, node.to),
          );
          return;
        }

        if (isReferenceLabel(node.node)) {
          if (!lineHasSelection(state, node.from)) {
            ranges.push(hidden.range(node.from, node.to));
          }
          return;
        }

        // --- Hide syntax markers, revealing them on the active line
        if (HIDDEN_MARKS.has(name) && !isDefinitionColon(node.node)) {
          if (lineHasSelection(state, node.from)) return;
          let end = node.to;
          // For heading markers, also swallow the trailing space(s).
          if (name === 'HeaderMark') {
            while (end < doc.length && doc.sliceString(end, end + 1) === ' ') {
              end++;
            }
          }
          if (end > node.from) {
            ranges.push(hidden.range(node.from, end));
          }
          return;
        }
      },
    });
  }

  // Direction on every visible line, read off the document text rather than
  // the rendered line, so revealing a line's markers by putting the cursor on
  // it cannot turn it around.
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = doc.lineAt(pos);
      const dir = directionAt(state, line);
      if (dir) ranges.push(dirDeco[dir].range(line.from));
      pos = line.to + 1;
    }
  }

  // Sort: decorations must be ordered by position (and start side).
  return Decoration.set(ranges, true);
}

/**
 * Rendered tables, kept apart from the plugin above because CodeMirror only
 * takes *block* decorations from a state field — they change the height map,
 * which a view plugin is not allowed to do. That also means no viewport to
 * narrow the walk to.
 *
 * ponytail: rebuilt over the whole document on every edit and every selection
 * change, since there is no viewport to narrow it to. Measured 0.66 ms for a
 * document of 200 tables and 0.98 ms for one table of 5000 rows; a document
 * without tables costs nothing, the tree walk skips it. Past that, map the set
 * through the changes and rebuild only the table that was touched.
 */
export function buildTables(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const doc = state.doc;
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table') return;

      // Rendered while the cursor is elsewhere, source as soon as the
      // selection touches it — the same reveal rule the inline markers
      // follow, over a range instead of a line.
      if (rangeHasSelection(state, node.from, node.to)) return;
      const rows: Segment[][][] = [];
      let header: Segment[][] = [];
      let align: TableSpec['align'] = [];
      for (let row = node.node.firstChild; row; row = row.nextSibling) {
        if (row.name === 'TableDelimiter') {
          // The `|---|:--:|` row, which is a delimiter spanning the line
          // rather than one per pipe.
          if (row.to - row.from > 1) align = columnAlignment(doc.sliceString(row.from, row.to));
          continue;
        }
        // Only real rows: inside a blockquote the parser hangs a QuoteMark on
        // the table for every line, and those are not rows.
        if (row.name !== 'TableHeader' && row.name !== 'TableRow') continue;
        const cells = rowCells(row, doc);
        if (row.name === 'TableHeader') header = cells;
        else rows.push(cells);
      }
      // GFM sizes every row by the header: a short row is padded, a long one
      // is cut. Without that a ragged row would grow a column of its own and
      // push the table out of shape.
      const width = header.length;
      const sized = rows.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? []));

      ranges.push(
        Decoration.replace({
          widget: new TableWidget({
            from: node.from,
            header,
            rows: sized,
            align,
            dir: blockDirection(state, node.from, node.to),
            source: doc.sliceString(node.from, node.to),
          }),
          block: true,
        }).range(node.from, node.to),
      );
      return false;
    },
  });
  return Decoration.set(ranges, true);
}

export const tableField = StateField.define<DecorationSet>({
  create: (state) => buildTables(state),
  update: (value, tr) => (
    // The tree too: the parser only reaches the first few thousand characters
    // up front and finishes in the background, and that transaction carries
    // neither a document change nor a selection. Without this a table further
    // down stays raw pipes until something else happens to touch the editor.
    tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState)
      ? buildTables(tr.state)
      : value
  ),
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * The live-preview decoration plugin. Rebuilds on document, viewport and
 * selection changes (the last so syntax reveals/hides as the cursor moves).
 */
export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        // See tableField: the background parse arrives on its own transaction.
        // Long-standing — bold past the first few thousand characters did not
        // render either until something else redrew.
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    // Hidden ranges must be atomic so clicking past them behaves; but keep the
    // active line editable. We rely on per-line reveal rather than atomicRanges
    // to avoid backspace traps (see CREDITS — Atomic Editor notes this).
  },
);
