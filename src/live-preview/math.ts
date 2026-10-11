import { tags } from '@lezer/highlight';
import type { Element, Line, MarkdownConfig } from '@lezer/markdown';

// `@lezer/markdown`'s own FencedCode reads both of these; they are just not in
// its typings. `depth` is how many of the open containers (quote, list item)
// this line continued, `markers` the `>` marks those containers consumed.
type ParsedLine = Line & { depth: number; markers: Element[] };

// Where a `$$` opens on this line, or -1. Four columns in is indented code.
function opening(line: Line): number {
  return line.indent - line.baseIndent < 4 && line.text.startsWith('$$', line.pos)
    ? line.pos
    : -1;
}

// Where the `$$` that ends this line starts, or -1. Never before `from`, so the
// `$$` that opened a block cannot also close it.
function closing(text: string, from: number): number {
  const end = text.trimEnd().length - 2;
  return end >= from && text.startsWith('$$', end) ? end : -1;
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
  ],
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
    endLeaf: (_cx, line) => opening(line) >= 0,
  }],
};
