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
