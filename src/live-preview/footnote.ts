import { syntaxTree } from '@codemirror/language';
import { type EditorState, StateField } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import type { BlockContext, Element, Line, MarkdownConfig } from '@lezer/markdown';

// As in math.ts: the container depth and markers lezer keeps on a line, which
// are not in its typings.
type ParsedLine = Line & { depth: number; markers: Element[] };

// `[^label]:` at the start of a block. A label is non-empty, with no white space
// and no `]`.
const DEFINITION = /^\[\^([^\s\]]+)\]:/;

// Any white space, a no-break space included (-1, past the end, counts too).
const space = (c: number): boolean => c === -1 || /\s/.test(String.fromCharCode(c));

// The inline markup of `line` between `from` and `to`, at its place in the doc.
function inline(cx: BlockContext, line: Line, from: number, to: number): Element[] {
  return cx.parser.parseInline(line.text.slice(from, to), cx.lineStart + from);
}

/**
 * Obsidian's footnotes: `text[^1]` refers to `[^1]: note`, and `^[note]` is a
 * note written in place. The tree is `FootnoteReference` > `FootnoteMark`,
 * `FootnoteLabel`, `FootnoteMark`; `FootnoteDefinition` > the marker in the same
 * three parts, then the note's inline text; `InlineFootnote` > `FootnoteMark`,
 * the inline text, `FootnoteMark`.
 *
 * A definition is a block of its own, not a link reference: it takes the lines
 * indented by two columns after it, and ends at a blank line or an unindented
 * one. It is a block parser, not a leaf one, because lezer's link reference is a
 * leaf and would take `[^1]: note\n  more` for a link before a leaf parser of
 * ours could finish.
 */
export const footnote: MarkdownConfig = {
  defineNodes: [
    { name: 'FootnoteDefinition', block: true },
    { name: 'FootnoteReference' },
    { name: 'InlineFootnote' },
    { name: 'FootnoteMark', style: tags.processingInstruction },
    { name: 'FootnoteLabel' },
  ],
  parseBlock: [{
    name: 'FootnoteDefinition',
    before: 'FencedCode',
    parse(cx, line) {
      const head = DEFINITION.exec(line.text.slice(line.pos));
      if (!head || line.indent - line.baseIndent >= 4) return false;
      const start = cx.lineStart + line.pos;
      const close = start + 2 + head[1].length;
      const children = [
        cx.elt('FootnoteMark', start, start + 2),
        cx.elt('FootnoteLabel', start + 2, close),
        cx.elt('FootnoteMark', close, close + 2),
      ];
      let from = line.pos + head[0].length;
      while (line.text[from] === ' ' || line.text[from] === '\t') from++;
      children.push(...inline(cx, line, from, line.text.length));
      // ponytail: each line's text is parsed as inline on its own, so emphasis
      // cannot run from one line of a note into the next. Add it when that shows.
      for (;;) {
        if (!cx.nextLine()) break;
        const next = line as ParsedLine;
        // Out of the quote or item it began in, blank, or not indented: it ends.
        if (next.depth < cx.depth || next.pos === next.text.length || next.indent - next.baseIndent < 2) break;
        children.push(...next.markers, ...inline(cx, line, next.pos, next.text.length));
      }
      cx.addElement(cx.elt('FootnoteDefinition', start, cx.prevLineEnd(), children));
      return true;
    },
    // Like a link reference in markdown-it-footnote, a definition may start
    // right under a paragraph line, with no blank line between.
    endLeaf: (_cx, line) => line.indent - line.baseIndent < 4 && DEFINITION.test(line.text.slice(line.pos)),
  }],
  parseInline: [{
    name: 'FootnoteReference',
    // `[^1]`, but not `[^ 1]` or `[^]`: a label is what is between `[^` and the
    // first `]`, and it has no white space in it.
    before: 'Link',
    parse(cx, next, pos) {
      if (next !== 91 || cx.char(pos + 1) !== 94) return -1;
      let end = pos + 2;
      while (end < cx.end && cx.char(end) !== 93 && !space(cx.char(end))) end++;
      if (end === pos + 2 || cx.char(end) !== 93) return -1;
      return cx.addElement(cx.elt('FootnoteReference', pos, end + 1, [
        cx.elt('FootnoteMark', pos, pos + 2),
        cx.elt('FootnoteLabel', pos + 2, end),
        cx.elt('FootnoteMark', end, end + 1),
      ]));
    },
  }, {
    name: 'InlineFootnote',
    // `^[note]`. Brackets inside the note balance, and a backslash escapes the
    // character after it. An empty note is no footnote, as `[^]` is none.
    before: 'Link',
    parse(cx, next, pos) {
      if (next !== 94 || cx.char(pos + 1) !== 91) return -1;
      let depth = 1;
      let close = pos + 2;
      while (close < cx.end) {
        const c = cx.char(close);
        if (c === 92) close++;
        else if (c === 91) depth++;
        else if (c === 93 && --depth === 0) break;
        close++;
      }
      if (depth !== 0 || close === pos + 2) return -1;
      return cx.addElement(cx.elt('InlineFootnote', pos, close + 1, [
        cx.elt('FootnoteMark', pos, pos + 2),
        ...cx.parser.parseInline(cx.slice(pos + 2, close), pos + 2),
        cx.elt('FootnoteMark', close, close + 1),
      ]));
    },
  }],
};

// The lezer node type, read off the API: `@lezer/common` is not a declared
// dependency (as in decorations.ts).
type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>;

/** A footnote as read mode lists it: its number, where it is first referred
 *  to, and the node holding its text (the definition, or the `^[note]`). */
export interface Note {
  n: number;
  ref: number;
  body: SyntaxNode;
}

export interface FootnoteIndex {
  /** The definition of each label: the first, if a label is defined twice. */
  defs: Map<string, SyntaxNode>;
  /** Every definition, for read mode to hide. */
  allDefs: SyntaxNode[];
  /** The number of each defined label, in the order of first reference. */
  numbers: Map<string, number>;
  /** The number of each reference and inline footnote, by where it starts. */
  numberAt: Map<number, number>;
  notes: Note[];
}

/**
 * Number the footnotes as Obsidian's reading view does: by first reference,
 * named ones too, and `^[inline]` notes in the same sequence. A reference to a
 * label that is defined nowhere gets no number, and a definition nothing
 * refers to is not listed.
 *
 * ponytail: a walk of the whole tree per parse, as the table and math fields
 * already do per transaction.
 */
export function footnoteIndex(state: EditorState): FootnoteIndex {
  const doc = state.doc;
  const defs = new Map<string, SyntaxNode>();
  const allDefs: SyntaxNode[] = [];
  const refs: { from: number; label: string | null; node: SyntaxNode }[] = [];
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name === 'FootnoteDefinition') {
        const label = n.node.getChild('FootnoteLabel');
        if (label) {
          const text = doc.sliceString(label.from, label.to);
          if (!defs.has(text)) defs.set(text, n.node);
        }
        allDefs.push(n.node);
        return false;
      }
      if (n.name === 'FootnoteReference') {
        const label = n.node.getChild('FootnoteLabel');
        if (label) refs.push({ from: n.from, label: doc.sliceString(label.from, label.to), node: n.node });
        return false;
      }
      if (n.name === 'InlineFootnote') {
        refs.push({ from: n.from, label: null, node: n.node });
        return false;
      }
    },
  });
  const numbers = new Map<string, number>();
  const numberAt = new Map<number, number>();
  const notes: Note[] = [];
  for (const ref of refs) {
    let n = ref.label === null ? undefined : numbers.get(ref.label);
    if (n === undefined) {
      const body = ref.label === null ? ref.node : defs.get(ref.label);
      if (!body) continue;
      n = notes.length + 1;
      notes.push({ n, ref: ref.from, body });
      if (ref.label !== null) numbers.set(ref.label, n);
    }
    numberAt.set(ref.from, n);
  }
  return { defs, allDefs, numbers, numberAt, notes };
}

/** The footnote index of the current tree, kept up to date as it changes. */
export const footnoteField = StateField.define<FootnoteIndex>({
  create: footnoteIndex,
  update: (value, tr) => (syntaxTree(tr.state) !== syntaxTree(tr.startState) ? footnoteIndex(tr.state) : value),
});

/** The index from the field, or worked out on the spot where the field is not
 *  installed (a bare state, as in the unit tests). */
export function footnotes(state: EditorState): FootnoteIndex {
  return state.field(footnoteField, false) ?? footnoteIndex(state);
}
