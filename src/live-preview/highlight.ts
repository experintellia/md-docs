import { tags } from '@lezer/highlight';
import type { DelimiterType, MarkdownConfig } from '@lezer/markdown';

// Obsidian's `==highlight==`, parsed as GFM parses `~~strikethrough~~`: the same
// flanking rules, and only a run of exactly two `=`. A lone `=` or a `===` run
// is text.
const HighlightDelim: DelimiterType = { resolve: 'Highlight', mark: 'HighlightMark' };

// The Unicode punctuation class lezer uses for flanking, which it does not export.
const Punctuation = /[\p{S}|\p{P}]/u;

// The color emoji that may open a highlight, and the class each paints with. Each
// is one astral code point, so two UTF-16 units: `==🔴text==` opens with the 2
// units after the `==`.
export const HIGHLIGHT_COLORS: Record<string, string> = {
  '🔴': 'red',
  '🟠': 'orange',
  '🟡': 'yellow',
  '🟢': 'green',
  '🔵': 'blue',
  '🟣': 'purple',
};

/**
 * `==text==` as a `Highlight` node, its `==` as `HighlightMark`s. A highlight
 * can nest with emphasis both ways, and a backslash escapes the `=`s.
 */
export const highlight: MarkdownConfig = {
  defineNodes: [
    { name: 'Highlight', style: tags.special(tags.content) },
    { name: 'HighlightMark', style: tags.processingInstruction },
  ],
  parseInline: [{
    name: 'Highlight',
    parse(cx, next, pos) {
      // Not a `===` run, nor the middle of one: `a===b===c` is text.
      if (next != 61 /* '=' */ || cx.char(pos + 1) != 61 || cx.char(pos + 2) == 61 || cx.char(pos - 1) == 61)
        return -1;
      const before = cx.slice(pos - 1, pos), after = cx.slice(pos + 2, pos + 3);
      const sBefore = /\s|^$/.test(before), sAfter = /\s|^$/.test(after);
      const pBefore = Punctuation.test(before), pAfter = Punctuation.test(after);
      return cx.addDelimiter(HighlightDelim, pos, pos + 2, !sAfter && (!pAfter || sBefore || pBefore), !sBefore && (!pBefore || sAfter || pAfter));
    },
    after: 'Emphasis',
  }],
};
