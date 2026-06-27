import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Range } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { BulletWidget } from './widgets/bullet';
import { CheckboxWidget } from './widgets/checkbox';

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
  'URL',
]);

const hidden = Decoration.replace({});

function headingClass(name: string): string | null {
  const m = /^ATXHeading(\d)$/.exec(name);
  return m ? `md-h${m[1]}` : null;
}

function buildDecorations(view: EditorView): DecorationSet {
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
        if (name === 'Blockquote' || name === 'FencedCode') {
          const cls = name === 'Blockquote' ? 'md-quote' : 'md-code-block';
          let pos = node.from;
          while (pos <= node.to) {
            const line = doc.lineAt(pos);
            ranges.push(Decoration.line({ class: cls }).range(line.from));
            if (line.to + 1 > node.to) break;
            pos = line.to + 1;
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
          ranges.push(
            Decoration.mark({ class: 'md-link' }).range(node.from, node.to),
          );
          return;
        }

        // --- List bullets: task items render as just the checkbox (hide the
        //     bullet); plain bullets show a • glyph, revealing the raw `-` on
        //     the active line. Ordered lists keep their number.
        if (name === 'ListMark') {
          const markText = doc.sliceString(node.from, node.to);
          if (!/^[-*+]$/.test(markText)) return;
          let end = node.to;
          if (doc.sliceString(end, end + 1) === ' ') end++;
          const after = doc.sliceString(end, doc.lineAt(node.from).to);
          if (/^\[[ xX]\]/.test(after)) {
            ranges.push(hidden.range(node.from, end));
          } else if (!lineHasSelection(state, node.from)) {
            ranges.push(
              Decoration.replace({ widget: new BulletWidget() }).range(
                node.from,
                end,
              ),
            );
          }
          return;
        }

        // --- Task list checkbox widget (always rendered, click toggles)
        if (name === 'TaskMarker') {
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
