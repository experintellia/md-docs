import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Line, type Range, type Text } from '@codemirror/state';
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

/**
 * The direction a block reads in: the first of its lines that decides one.
 *
 * Scanned line by line rather than over one slice of the whole block — a table
 * or an indented block thousands of lines long would be copied out and scanned
 * end to end on every rebuild, and rebuilds happen on every caret move. The
 * answer is almost always on the first line.
 */
function blockDirection(doc: Text, from: number, to: number): 'ltr' | 'rtl' | null {
  for (let pos = from; pos <= to;) {
    const line = doc.lineAt(pos);
    const dir = lineDirection(line.text);
    if (dir) return dir;
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
// ponytail: a code block inside an RTL quote still holds lines of two
// directions, and the per-line quote bar crosses sides for them; fixing that
// means a direction class on the quote, not the line.
function directionAt(state: EditorState, line: Line): 'ltr' | 'rtl' | null {
  let own = lineDirection(line.text);
  // Resolved at the line's end, not its start: an indented code block begins
  // after the indent, so the first column is not inside it.
  for (let n = syntaxTree(state).resolveInner(line.to, -1); ; n = n.parent) {
    if (n.name === 'FencedCode' || n.name === 'CodeBlock') return 'ltr';
    if (n.name === 'Table') return blockDirection(state.doc, n.from, n.to);
    if (!own && /^(?:Blockquote|BulletList|OrderedList)$/.test(n.name)) {
      own = blockDirection(state.doc, n.from, n.to);
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

function headingClass(name: string): string | null {
  const m = /^ATXHeading(\d)$/.exec(name);
  return m ? `md-h${m[1]}` : null;
}

// Pull the destination out of a `[text](url)` / `[text](url "title")` source.
function linkUrl(src: string): string | null {
  const m = /\]\(\s*([^)\s]+)/.exec(src);
  return m ? m[1] : null;
}

// A bare `www.foo` autolink has no scheme; window.open() would treat it as a
// relative path. Give it https so the click reaches the real site.
function withScheme(url: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
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
          const cls = name === 'Blockquote' ? 'md-quote' : 'md-code-block';
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
            : linkUrl(doc.sliceString(node.from, node.to));
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
            if (!lineHasSelection(state, node.from)) {
              ranges.push(hidden.range(node.from, node.to));
            }
            return;
          }
          const url = lineHasSelection(state, node.from)
            ? null
            : withScheme(doc.sliceString(node.from, node.to));
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

        // --- Hide syntax markers, revealing them on the active line
        if (HIDDEN_MARKS.has(name)) {
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
        update.selectionSet
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
