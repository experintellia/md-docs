import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { mathBlock } from './math.ts';
import { buildDecorations, buildMath } from './decorations.ts';
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
