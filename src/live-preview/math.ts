import { tags } from '@lezer/highlight';
import type { BlockContext, Element, Line, MarkdownConfig } from '@lezer/markdown';

// `@lezer/markdown`'s own FencedCode reads both of these; they are just not in
// its typings. `depth` is how many of the open containers (quote, list item)
// this line continued, `markers` the `>` marks those containers consumed.
type ParsedLine = Line & { depth: number; markers: Element[] };

// Where the `$$` that ends this line starts, or -1. Never before `from`, so the
// `$$` that opened a block cannot also close it, and not after an odd run of
// backslashes: `\$$` is an escaped dollar and then a `$`.
function closing(text: string, from: number): number {
  const end = text.trimEnd().length - 2;
  if (end < from || !text.startsWith('$$', end)) return -1;
  let slashes = 0;
  while (text[end - 1 - slashes] === '\\') slashes++;
  return slashes % 2 === 0 ? end : -1;
}

// Any white space, a no-break space included (-1, past the end, counts too).
const space = (c: number): boolean => c === -1 || /\s/.test(String.fromCharCode(c));

// Is the character before `pos` a `$` of its own, not an escaped one?
function dollarBefore(cx: { char(pos: number): number }, pos: number): boolean {
  let slashes = 0;
  while (cx.char(pos - 2 - slashes) === 92) slashes++;
  return cx.char(pos - 1) === 36 && slashes % 2 === 0;
}

// Where a `$$` opens on this line, or -1. Four columns in is indented code.
// Only a `$$` alone, or one closed at the end of the same line: a line of prose
// that merely starts with inline math (`$$a$$ and $$b$$ …`, `$$5 to $$10`) is
// a paragraph, as it was before blocks existed. Nor `$$$`, which is no opener.
function opening(line: Line): number {
  if (line.indent - line.baseIndent >= 4 || !line.text.startsWith('$$', line.pos)) return -1;
  if (line.text[line.pos + 2] === '$') return -1;
  const close = closing(line.text, line.pos + 2);
  return line.text.indexOf('$$', line.pos + 2) === (close < 0 ? -1 : close) ? line.pos : -1;
}

// Past this length a paragraph's `$$` line starts a block, as before. Each
// such line asks the inline parser about the whole paragraph so far.
const MAX_OPEN_PARAGRAPH = 2000;

// Is this leaf a GFM table so far? Its second line is the `|---|` row.
function isTable(text: string): boolean {
  const delimiter = text.split('\n', 2)[1] ?? '';
  return delimiter.includes('|') && delimiter.includes('-') && /^[\s|:-]*$/.test(delimiter);
}

// Would a `$$` after this paragraph text close a `$$` open in it? Asked of the
// inline parser itself, so a `$$` in code, a URL or an attribute is not one.
function closesDisplayMath(cx: BlockContext, text: string): boolean {
  if (text.length > MAX_OPEN_PARAGRAPH) return false;
  const id = cx.parser.nodeSet.types.find((type) => type.name === 'DisplayMath')!.id;
  const withClose = `${text}\n$$`;
  return cx.parser.parseInline(withClose, 0).some((elt) => elt.type === id && elt.to === withClose.length);
}

/**
 * `$$ … $$` display math as a block, the way Obsidian, GitHub and Pandoc read
 * it: `$$` opens a line, the block runs until a line ending in `$$`, and either
 * may share its line with TeX (`$$ x^2 $$` is a block of its own). The tree is
 * `MathBlock` > `MathMark`, one `MathText` per line of TeX, `MathMark`, so the
 * live preview can read the TeX back out without the `>` of a quote around it.
 *
 * A blank line ends an unclosed block. TeX does not allow one in display math
 * anyway, and it keeps a stray `$$` — or one just typed — from swallowing the
 * rest of the document the way an unclosed ``` fence does. The live preview
 * renders only a closed block.
 */
export const mathBlock: MarkdownConfig = {
  defineNodes: [
    { name: 'MathBlock', block: true },
    { name: 'MathMark', style: tags.processingInstruction },
    { name: 'MathText', style: tags.monospace },
    { name: 'DisplayMath' },
    { name: 'InlineMath' },
  ],
  parseInline: [{
    name: 'DisplayMath',
    // `hello $$ x^2 $$`: display math in the middle of a paragraph, which
    // Obsidian typesets on a line of its own below the text before it. It may
    // run on over the paragraph's next lines (`endLeaf` below keeps a `$$`
    // alone on one of them as its close).
    parse(cx, next, pos) {
      // `$$$` is no opener, as for a block: not at its first `$`, nor its second.
      if (next !== 36 || cx.char(pos + 1) !== 36 || cx.char(pos + 2) === 36 || dollarBefore(cx, pos)) return -1;
      for (let i = pos + 2; i < cx.end; i++) {
        const c = cx.char(i);
        if (c === 92) i++; // `\$` is an escaped dollar, not a close
        else if (c === 36 && cx.char(i + 1) === 36) {
          const children = [cx.elt('MathMark', pos, pos + 2), cx.elt('MathMark', i, i + 2)];
          if (i > pos + 2) children.splice(1, 0, cx.elt('MathText', pos + 2, i));
          return cx.addElement(cx.elt('DisplayMath', pos, i + 2, children));
        }
      }
      return -1;
    },
  }, {
    name: 'InlineMath',
    // `$x^2$`, in the text, on Pandoc's and Obsidian's rules so that most
    // money is not math: no space just inside either `$`, and the next `$` is
    // the only close — not one if a digit follows it (`$5 and $10`), and then
    // the first `$` is text. One line only, as in Obsidian.
    parse(cx, next, pos) {
      // Nor half of a `$$` that found no close.
      if (next !== 36 || dollarBefore(cx, pos) || cx.char(pos + 1) === 36 || space(cx.char(pos + 1))) return -1;
      for (let i = pos + 1; i < cx.end; i++) {
        const c = cx.char(i);
        // A `\` at the end of the line is a hard break, not an escape.
        if (c === 10 || (c === 92 && cx.char(i + 1) === 10)) return -1;
        if (c === 92) i++; // `\$` is an escaped dollar, not a close
        else if (c === 36) {
          if (space(cx.char(i - 1)) || (cx.char(i + 1) >= 48 && cx.char(i + 1) <= 57)) return -1;
          return cx.addElement(cx.elt('InlineMath', pos, i + 1, [
            cx.elt('MathMark', pos, pos + 1), cx.elt('MathText', pos + 1, i), cx.elt('MathMark', i, i + 1),
          ]));
        }
      }
      return -1;
    },
  }],
  parseBlock: [{
    name: 'MathBlock',
    before: 'FencedCode',
    parse(cx, line) {
      const open = opening(line);
      if (open < 0) return false;
      const start = cx.lineStart + open;
      const children = [cx.elt('MathMark', start, start + 2)];
      const text = (from: number, to: number): void => {
        if (to > from) children.push(cx.elt('MathText', cx.lineStart + from, cx.lineStart + to));
      };
      let from = open + 2;
      for (;;) {
        const close = closing(line.text, from);
        if (close >= 0) {
          text(from, close);
          children.push(cx.elt('MathMark', cx.lineStart + close, cx.lineStart + close + 2));
          cx.nextLine();
          break;
        }
        text(from, line.text.length);
        if (!cx.nextLine()) break;
        const next = line as ParsedLine;
        if (next.depth < cx.depth || next.pos === next.text.length) break;
        children.push(...next.markers);
        from = next.basePos;
      }
      cx.addElement(cx.elt('MathBlock', start, cx.prevLineEnd(), children));
      return true;
    },
    // Like a fence, `$$` starts its block without a blank line above it.
    // But not when it closes the paragraph's own `$$` (`text $$`, TeX, `$$`),
    // as in Obsidian — text typed on after that `$$` included.
    // A table is no such paragraph: its cells are parsed one by one, so no
    // later line can close a `$$` in one.
    endLeaf: (cx, line, leaf) => opening(line) >= 0
      && (isTable(leaf.content) || !closesDisplayMath(cx, leaf.content)),
  }],
};
