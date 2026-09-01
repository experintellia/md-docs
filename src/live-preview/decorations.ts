import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Range } from '@codemirror/state';
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
          const body = node.node.getChild('CodeText');
          if (body) {
            ranges.push(
              Decoration.widget({
                widget: new CopyButtonWidget(doc.sliceString(body.from, body.to)),
                side: 1,
              }).range(doc.lineAt(node.from).to),
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
