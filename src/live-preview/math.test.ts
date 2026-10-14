import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { mathBlock } from './math.ts';
import { buildDecorations, buildMath, buildTables } from './decorations.ts';
import { TableWidget } from './widgets/table.ts';
import { MathWidget } from './widgets/math.ts';

// `$$` blocks: the parser extension, then what the live preview makes of the
// tree. Headless like decorations.test.ts — buildMath reads only the state.

function state(doc: string, cursor = 0): EditorState {
  const s = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage, extensions: [mathBlock] })],
  });
  ensureSyntaxTree(s, s.doc.length, 5000);
  return s;
}

// The block-level nodes, and the math ones inside, as `Name:text`.
function tree(doc: string): string[] {
  const s = state(doc);
  const out: string[] = [];
  ensureSyntaxTree(s, s.doc.length, 5000)!.iterate({
    enter: (n) => {
      if (n.name === 'Document') return;
      out.push(/^Math(?:Mark|Text)$/.test(n.name)
        ? `${n.name}:${s.doc.sliceString(n.from, n.to)}`
        : n.name);
      // The inline contents of a paragraph or heading are not the point here.
      if (!/^(?:MathBlock|Blockquote|BulletList|ListItem)$/.test(n.name)) return false;
    },
  });
  return out;
}

// The TeX of the rendered block, or undefined if the source is left up.
function rendered(doc: string, cursor = 0): string | undefined {
  const s = state(doc, cursor);
  let tex: string | undefined;
  buildMath(s).between(0, s.doc.length, (_f, _t, deco) => {
    const widget = (deco.spec as { widget?: unknown }).widget;
    if (widget instanceof MathWidget) tex = widget.tex;
  });
  return tex;
}

// The issue's own example (#27), verbatim.
const ISSUE = String.raw`# temp

$$
\Omega = \{ (\omega_1 , \omega_2) \, | \, \omega \in \{1,2,3\} \}
\\
\Omega = \{ (1,2), (1,3), (2,1), (2,3), (3,1), (3,2) \}
$$`;

test('the example from the issue is one math block, line for line', () => {
  assert.deepEqual(tree(ISSUE), [
    'ATXHeading1',
    'MathBlock',
    'MathMark:$$',
    String.raw`MathText:\Omega = \{ (\omega_1 , \omega_2) \, | \, \omega \in \{1,2,3\} \}`,
    String.raw`MathText:\\`,
    String.raw`MathText:\Omega = \{ (1,2), (1,3), (2,1), (2,3), (3,1), (3,2) \}`,
    'MathMark:$$',
  ]);
});

test('it renders, with the TeX intact — escapes and `\\` are not markdown here', () => {
  assert.equal(rendered(ISSUE), ISSUE.split('$$')[1].slice(1, -1));
});

test('`$$ x $$` on one line is a block of its own', () => {
  assert.deepEqual(tree('$$ x^2 $$'), ['MathBlock', 'MathMark:$$', 'MathText: x^2 ', 'MathMark:$$']);
  assert.equal(rendered('$$ x^2 $$\n\nafter', 12), ' x^2 ');
});

test('TeX may share a line with either `$$`', () => {
  assert.equal(rendered('$$\\begin{matrix}\na\n\\end{matrix}$$\n\nafter', 38), '\\begin{matrix}\na\n\\end{matrix}');
});

test('`$$` ends a paragraph without a blank line, as a fence does', () => {
  assert.deepEqual(tree('text\n$$\nx\n$$'), ['Paragraph', 'MathBlock', 'MathMark:$$', 'MathText:x', 'MathMark:$$']);
});

test('an unclosed block stops at a blank line instead of eating the document', () => {
  // As typed: `$$`, Enter, some TeX, and the rest of the note still below.
  assert.deepEqual(tree('$$\nx\n\n# Title\n\ntext'), [
    'MathBlock', 'MathMark:$$', 'MathText:x', 'ATXHeading1', 'Paragraph',
  ]);
  assert.equal(rendered('$$\nx\n\n# Title'), undefined, 'and it is not rendered half-done');
});

test('a lone `$$` is an opener, not an empty block', () => {
  assert.deepEqual(tree('$$'), ['MathBlock', 'MathMark:$$']);
  assert.equal(rendered('$$\n$$'), undefined, 'an empty block has nothing to typeset');
});

test('a block in a quote reads its TeX without the `>` marks', () => {
  assert.equal(rendered('> $$\n> a\n> b\n> $$\n\nafter', 22), 'a\nb');
});

test('a block in a list item reads its TeX without the indent', () => {
  assert.equal(rendered('- $$\n  a\n  $$\n\nafter', 17), 'a');
});

test('a quote that ends first takes the unclosed block with it', () => {
  // `plain` is outside the quote, so it cannot close a block opened inside.
  assert.equal(rendered('> $$\n> x\nplain $$'), undefined);
});

test('indented four columns, `$$` is code, not math', () => {
  assert.deepEqual(tree('    $$\n    x\n    $$'), ['CodeBlock']);
});

test('`$$` inside a fenced code block stays code', () => {
  assert.deepEqual(tree('```\n$$\nx\n$$\n```'), ['FencedCode']);
});

test('the source shows as soon as the selection touches the block', () => {
  const doc = 'text\n\n$$\nx\n$$\n\nafter';
  assert.equal(rendered(doc, 0), 'x', 'cursor above it');
  assert.equal(rendered(doc, doc.indexOf('\nx') + 1), undefined, 'cursor in the TeX');
  assert.equal(rendered(doc, doc.lastIndexOf('$$') + 2), undefined, 'cursor at its end');
  assert.equal(rendered(doc, doc.length), 'x', 'cursor below it');
});

test('while edited it looks like a code block, and reads left-to-right', () => {
  const s = state('مرحبا\n\n$$\nx\n$$', 10);
  const view = { state: s, visibleRanges: [{ from: 0, to: s.doc.length }] } as unknown as EditorView;
  const lines: Record<number, string[]> = {};
  buildDecorations(view).between(0, s.doc.length, (from, _to, deco) => {
    const spec = deco.spec as { class?: string; attributes?: { dir?: string } };
    const n = s.doc.lineAt(from).number;
    lines[n] = [...(lines[n] ?? []), spec.class ?? `dir=${spec.attributes?.dir}`];
  });
  assert.deepEqual(lines[1], ['dir=rtl']);
  assert.deepEqual(lines[3], ['md-code-block md-code-first', 'dir=ltr']);
  assert.deepEqual(lines[4], ['md-code-block', 'dir=ltr']);
  assert.deepEqual(lines[5], ['md-code-block md-code-last', 'dir=ltr']);
});

test('rendered in a quote or list, it leaves no code styling on the `> ` / `- ` line', () => {
  // The widget starts after the marker, so that marker keeps a line of its own.
  for (const doc of ['> $$\n> a\n> $$\n\nafter', '- $$\n  a\n  $$\n\nafter']) {
    const s = state(doc, doc.length);
    const view = { state: s, visibleRanges: [{ from: 0, to: s.doc.length }] } as unknown as EditorView;
    const classes: string[] = [];
    buildDecorations(view).between(0, s.doc.length, (_f, _t, deco) => {
      const cls = (deco.spec as { class?: string }).class;
      if (cls) classes.push(cls);
    });
    assert.ok(!classes.some((c) => c.includes('md-code-block')), `${JSON.stringify(doc)}: ${classes.join(', ')}`);
    assert.ok(rendered(doc, doc.length), 'and it is rendered');
  }
});

test('a line that merely starts with inline math stays prose', () => {
  // Notes written before blocks existed: `$$` here is inline math or money.
  assert.deepEqual(tree('Intro.\n\n$$a$$ and $$b$$ are equal,\nas shown by **bold** $$c$$\n\nz'), [
    'Paragraph', 'Paragraph', 'Paragraph',
  ]);
  assert.deepEqual(tree('The cost went from\n$$5 to $$10 this year,\nwhich is a lot.'), ['Paragraph']);
  assert.deepEqual(tree('| a | b |\n|---|---|\n$$x$$ | y\n| c | d |'), ['Table']);
});

test('an escaped dollar does not close a block, an escaped backslash does', () => {
  assert.equal(rendered('$$\na \\$$\nb\n$$\n\nz', 16), 'a \\$$\nb');
  assert.equal(rendered('$$\na \\\\$$\n\nz', 12), 'a \\\\');
});

test('`$$$` opens nothing', () => {
  assert.deepEqual(tree('$$$\na\n$$'), ['Paragraph', 'MathBlock', 'MathMark:$$']);
});

// Every TeX typeset, in order.
function allRendered(doc: string, cursor = doc.length): string[] {
  const s = state(doc, cursor);
  const out: string[] = [];
  buildMath(s).between(0, s.doc.length, (_f, _t, deco) => {
    const widget = (deco.spec as { widget?: unknown }).widget;
    if (widget instanceof MathWidget) out.push(widget.tex.trim());
  });
  return out;
}

// What Obsidian typesets as display math, with the cursor out of the way.
test('`$$` in the middle of a paragraph is typeset there, as in Obsidian', () => {
  const cases: [string, string[]][] = [
    ['hello $$ E = mc^2 $$', ['E = mc^2']],
    ['hello $$x$$ world', ['x']],
    ['$$a$$ and $$b$$ are equal', ['a', 'b']],
    ['- item $$x$$', ['x']],
    ['# Title $$x$$', ['x']],
    ['We get $$ a +\nb $$ here', ['a +\nb']],
    ['We get $$\nE = mc^2\n$$', ['E = mc^2']],
    ['> We get $$\n> a\n> $$', ['a']],
    ['- We get $$\n  a\n  $$', ['a']],
    ['a $$x \\$$ b', []],
    ['a $$$x$$ b', []],
    ['We get $$ f(x)\n    > 0 $$', ['f(x)\n    > 0']],
    ['> We get $$ f(x)\n>     > 0 $$', ['f(x)\n     > 0']],
    ['a `$$x$$` b', []],
    ['a $$ $$ b', []],
    ['| a | b |\n|---|---|\n| $$x$$ | y |', []],
  ];
  for (const [doc, tex] of cases) {
    assert.deepEqual(allRendered(`${doc}\n\nend`), tex, JSON.stringify(doc));
  }
});

test('its source shows while the cursor is in it', () => {
  const doc = 'hello $$ E = mc^2 $$\n\nafter';
  assert.deepEqual(allRendered(doc, 10), []);
  assert.deepEqual(allRendered(doc, 1), ['E = mc^2'], 'beside it is not in it');
});

test('a `$$` alone after a paragraph still opens a block, unless it closes one', () => {
  const block = ['Paragraph', 'MathBlock', 'MathMark:$$', 'MathText:y', 'MathMark:$$'];
  assert.deepEqual(tree('text $$x$$\n$$\ny\n$$'), block);
  assert.deepEqual(tree('text $$\ny\n$$'), ['Paragraph']);
  // A `$$` the paragraph's inline parse does not open is not one to close.
  assert.deepEqual(tree('Wrap TeX in `$$`, like this:\n$$\ny\n$$'), block);
  assert.deepEqual(tree('See <span title="$$">a</span>\n$$\ny\n$$'), block);
  assert.deepEqual(tree('See [a](http://a/$$)\n$$\ny\n$$'), block);
});

test('a paragraph of many `$$` lines still parses in linear time', () => {
  // Each `$$` alone asks the inline parser about the paragraph so far.
  for (const doc of ['a $$\n' + '$$\n'.repeat(20_000), 'a $$\n' + '$$ x $$\n'.repeat(20_000)]) {
    const started = performance.now();
    state(doc);
    assert.ok(performance.now() - started < 2000, `${doc.slice(0, 12)}…: ${performance.now() - started} ms`);
  }
});

// Every `$ … $` typeset in the text, in order.
function inlineRendered(doc: string, cursor = doc.length): string[] {
  const s = state(doc, cursor);
  const out: string[] = [];
  buildMath(s).between(0, s.doc.length, (_f, _t, deco) => {
    const widget = (deco.spec as { widget?: unknown }).widget;
    if (widget instanceof MathWidget && !widget.display) out.push(widget.tex);
  });
  return out;
}

// Obsidian's (and Pandoc's) rules for a single `$`, which keep money prose.
test('`$ … $` is math in the text, and money is not', () => {
  const cases: [string, string[]][] = [
    ['the area is $\\pi r^2$, roughly', ['\\pi r^2']],
    ['$a$ and $b$', ['a', 'b']],
    ['**bold $x$** and [link $y$](u)', ['x', 'y']],
    ['- [ ] task $x$', ['x']],
    ['> quote $x$', ['x']],
    ['it costs $5 and $10 today', []],
    ['from $5 to $6.', []],
    ['$x$5', []],
    ['from $5 to $10 and $x$', ['x']],
    ['Tickets cost $5 and the formula is $E=mc^2$.', ['E=mc^2']],
    ['$x$5 and $y$', ['y']],
    ['x $a\\\nb$ y', []],
    ['$ x$ and $x $', []],
    ['$$', []],
    ['a \\$x$ b', []],
    ['$a \\$ b$', ['a \\$ b']],
    ['`$x$`', []],
    ['$x\ny$', []],
    ['hello $$x$$', []],
    ['| $x$ | y |\n|---|---|\n| 1 | 2 |', []],
  ];
  for (const [doc, tex] of cases) {
    assert.deepEqual(inlineRendered(`${doc}\n\nend`), tex, JSON.stringify(doc));
  }
});

test('`$ … $` shows its source while the cursor is in it', () => {
  assert.deepEqual(inlineRendered('a $x$ b', 4), []);
  assert.deepEqual(inlineRendered('a $x$ b', 1), ['x']);
});

test('`$ … $` keeps markdown out of its TeX', () => {
  assert.deepEqual(tree('$a_1 * b_2 * c$')[0], 'Paragraph');
  assert.deepEqual(inlineRendered('$a_1 * b_2 * c$\n\nz'), ['a_1 * b_2 * c']);
});

// The math in a rendered table's body cells, per cell, as `tex` or `$$tex`.
function cellMath(doc: string): string[][] {
  const s = state(doc, doc.length);
  let widget: TableWidget | undefined;
  buildTables(s).between(0, s.doc.length, (_f, _t, deco) => {
    const w = (deco.spec as { widget?: unknown }).widget;
    if (w instanceof TableWidget) widget = w;
  });
  return widget!.spec.rows[0].map((cell) => cell.flatMap((seg) => (
    seg.math ? [`${seg.math.display ? '$$' : ''}${seg.math.tex}`] : []
  )));
}

test('math in a table cell is typeset by the table', () => {
  const table = (row: string): string => `| a | b |\n|---|---|\n${row}\n\nend`;
  assert.deepEqual(cellMath(table('| $x^2$ | y |')), [['x^2'], []]);
  assert.deepEqual(cellMath(table('| $$x$$ | $a$ and $b$ |')), [['$$x'], ['a', 'b']]);
  assert.deepEqual(cellMath(table('| $5 | $10 |')), [[], []], 'money stays text');
  // A pipe in a cell is written `\|`, in math as in code.
  assert.deepEqual(cellMath(table('| $\\|x\\|$ | y |')), [['|x|'], []]);
  assert.deepEqual(cellMath(table('| `$x$` | y |')), [[], []], 'code stays code');
});

// Beside the rest of markdown, `$` behaves like a code span: whichever of math
// and its neighbour starts first wins, and nothing inside math is markdown —
// Pandoc's order.
test('`$ … $` beside emphasis, links, code, HTML and escapes', () => {
  const cases: [string, string[]][] = [
    ['*$a*b$* and **$x$**', ['a*b', 'x']],
    ['~~$x$~~ and _$a_b$_', ['x', 'a_b']],
    ['~~a $x~~ b$', ['x~~ b']],
    ['[$a]$](u)', ['a]']],
    ['[a](http://x/$y$)', []],
    ['<http://a/$x$>', []],
    ['see http://a.com/$x$ or www.a.com/$y$', []],
    ['<span title="$">a</span> b$', []],
    ['a <!-- $x$ --> b', []],
    ['<b>$x$</b>', ['x']],
    ['&#36;x$ and $y&#36;', []],
    ['$x &amp; y$', ['x &amp; y']],
    ['\\\\$x$', ['x']],
    ['\\\\\\$x$', []],
    ['$x\\\\$', ['x\\\\']],
    ['`a`$x$`b`', ['x']],
    ['$`a`$', ['`a`']],
    ['`$`x$', []],
    ['a $x$  \nb $y$\\\nc', ['x', 'y']],
  ];
  for (const [doc, tex] of cases) {
    assert.deepEqual(inlineRendered(`${doc}\n\nend`), tex, JSON.stringify(doc));
  }
});

test('`$ … $` in headings, lists and code blocks, and among any text', () => {
  const cases: [string, string[]][] = [
    ['# $x$', ['x']],
    ['$x$\n---', ['x']],
    ['1. $x$', ['x']],
    ['    $x$', []],
    ['```\n$x$\n```', []],
    ['<div>$x$</div>', []],
    ['a$x$b 日本$y$語 é$z$é', ['x', 'y', 'z']],
    ['مرحبا $x$ عالم', ['x']],
    ['($x$), $y$. "$z$" «$w$»', ['x', 'y', 'z', 'w']],
    ['$x$y$', ['x']],
    ['$x$\t$y$ and $\t$', ['x', 'y']],
  ];
  for (const [doc, tex] of cases) {
    assert.deepEqual(inlineRendered(`${doc}\n\nend`), tex, JSON.stringify(doc));
  }
  assert.deepEqual(inlineRendered('$x$ and $y$', 4), ['x', 'y'], 'at the very start and end');
  // CodeMirror splits lines on `\r\n` too, so Windows files read the same.
  assert.deepEqual(allRendered('a $x$\r\nb\r\n\r\n$$\r\ny\r\n$$', 0), ['x', 'y']);
});

test('`$$` mid-paragraph beside emphasis, tasks, quotes and what ends a paragraph', () => {
  const cases: [string, string[]][] = [
    ['**a $$x$$ b**', ['x']],
    ['- [x] $$y$$', ['y']],
    ['a $$ <b> [l](u) $$', ['<b> [l](u)']],
    ['> > a $$\n> > b\n> > $$', ['b']],
    // A lazy continuation line is still the quote's paragraph.
    ['> a $$\nb $$', ['b']],
    ['a $$ b\n    c $$', ['b\n    c']],
    // A heading, quote, list or fence ends the paragraph, and the `$$` with it.
    ['a $$ b\n# c $$', []],
    ['a $$ b\n> c $$', []],
    ['a $$ b\n- c $$', []],
    ['a $$ b\n```\nc $$', []],
  ];
  for (const [doc, tex] of cases) {
    assert.deepEqual(allRendered(`${doc}\n\nend`), tex, JSON.stringify(doc));
  }
});

test('an escaped dollar is text, not half of a `$$`', () => {
  // `\$$p$` is a dollar sign and then math, as in LaTeX and Pandoc.
  assert.deepEqual(inlineRendered('price is \\$$p$ each\n\nend'), ['p']);
  assert.deepEqual(inlineRendered('\\\\\\$$x$\n\nend'), ['x']);
  assert.deepEqual(allRendered('a \\$$$x$$ b\n\nend'), ['x']);
});

test('a non-breaking space next to `$` is a space', () => {
  // French puts one before the currency sign: `5 $` is money, not math.
  assert.deepEqual(inlineRendered('de 5 $ à 10 $.\n\nend'), []);
  assert.deepEqual(inlineRendered('$ x$ and $x $\n\nend'), []);
});

// The rendered table's widget spec, the cursor below it unless given.
function tableSpec(doc: string, cursor = doc.length, readOnly = false): TableWidget['spec'] | undefined {
  const s = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage, extensions: [mathBlock] }), EditorState.readOnly.of(readOnly)],
  });
  ensureSyntaxTree(s, s.doc.length, 5000);
  let spec: TableWidget['spec'] | undefined;
  buildTables(s).between(0, s.doc.length, (_f, _t, deco) => {
    const w = (deco.spec as { widget?: unknown }).widget;
    if (w instanceof TableWidget) spec = w.spec;
  });
  return spec;
}

test('math in a header cell is typeset by the table too', () => {
  const { header } = tableSpec('| $x^2$ | $$y$$ |\n|---|---|\n| 1 | 2 |\n\nend')!;
  assert.deepEqual(header.map((cell) => cell.map((seg) => seg.math)), [
    [{ tex: 'x^2', display: false }], [{ tex: 'y', display: true }],
  ]);
});

test('math beside an empty cell keeps its column, and unclosed math stays text', () => {
  const table = (row: string): string => `| a | b |\n|---|---|\n${row}\n\nend`;
  assert.deepEqual(cellMath(table('| | $x$ |')), [[], ['x']]);
  assert.deepEqual(cellMath(table('| $x$ | |')), [['x'], []]);
  assert.deepEqual(
    tableSpec(table('| $x | $$y |'))!.rows[0].map((cell) => cell.map((seg) => seg.text).join('')),
    ['$x', '$$y'],
  );
});

test('math in a table in a quote or a list item is typeset by that table', () => {
  for (const doc of ['> | a |\n> |---|\n> | $x$ |\n\nend', '- | a |\n  |---|\n  | $x$ |\n\nend']) {
    assert.deepEqual(cellMath(doc), [['x']], JSON.stringify(doc));
  }
});

test('math in a cell\'s link text is typeset, as it is in the text', () => {
  // In the text `[a $y$](u)` typesets `y`; a cell flattens a link's text to
  // its source, so the reader would see `$y$`.
  assert.deepEqual(inlineRendered('[a $y$](http://a)\n\nend'), ['y']);
  const [cell] = tableSpec('| a |\n|---|\n| [a $y$](http://a) |\n\nend')!.rows[0];
  assert.deepEqual(cell.flatMap((seg) => (seg.math ? [seg.math.tex] : [])), ['y'], JSON.stringify(cell));
  assert.ok(!cell.some((seg) => !seg.math && seg.text.includes('$')), JSON.stringify(cell));
});

test('read mode typesets math even under the caret', () => {
  // There is no editing to show the source for (see rangeHasSelection).
  const doc = '| a |\n|---|\n| $x$ |\n\nend';
  assert.deepEqual(tableSpec(doc, doc.indexOf('$x') + 1, true)!.rows[0][0][0].math, { tex: 'x', display: false });
  const s = EditorState.create({
    doc: 'a $x$ b',
    selection: { anchor: 3 },
    extensions: [markdown({ base: markdownLanguage, extensions: [mathBlock] }), EditorState.readOnly.of(true)],
  });
  ensureSyntaxTree(s, s.doc.length, 5000);
  assert.equal(buildMath(s).size, 1);
});

test('lines full of `$` parse and decorate in linear time', () => {
  // Each `$` makes the inline parsers scan ahead; none may scan the rest of the
  // paragraph for every one. 50,000 characters each, from another peer.
  const docs = [
    '$a$ '.repeat(12_500), // 12,500 formulas in one paragraph
    '$a $'.repeat(12_500), // openers that never close
    'it costs $5 and '.repeat(3_125), // money
    '$$a\\'.repeat(12_500), // `$$` whose close is escaped
    'a $$\nb\n'.repeat(6_250), // `$$` over lines
    '`$$`$$'.repeat(8_333), // `$$` in code between real ones
    '| a | b |\n|---|---|\n' + '| $x$ | $$y$$ |\n'.repeat(3_125), // a long table
  ];
  for (const doc of docs) {
    const started = performance.now();
    const s = state(doc);
    buildMath(s);
    buildTables(s);
    const ms = performance.now() - started;
    assert.ok(ms < 3000, `${JSON.stringify(doc.slice(0, 16))}…: ${Math.round(ms)} ms`);
  }
});
