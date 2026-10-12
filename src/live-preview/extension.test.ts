import { test, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();
// KaTeX refuses to render outside standards mode, and happy-dom has no
// `compatMode` at all. The app is in standards mode: index.html has a doctype.
Object.defineProperty(document, 'compatMode', { value: 'CSS1Compat' });
const { EditorState } = await import('@codemirror/state');
const { EditorView } = await import('@codemirror/view');
const { livePreview } = await import('./index.ts');
const { markdown, markdownLanguage } = await import('@codemirror/lang-markdown');
const { ensureSyntaxTree } = await import('@codemirror/language');
const { tableField } = await import('./decorations.ts');
const { mathBlock } = await import('./math.ts');
const { render, MAX_TEX } = await import('./widgets/math.ts');
const katex = (await import('katex')).default;
after(() => GlobalRegistrator.unregister());

// Tier 2: the direction decorations are only half the feature. Without
// `perLineTextDirection` CodeMirror assumes one direction for the whole editor
// and keeps moving the caret as if every line were left-to-right — the lines
// would look right and behave wrong. The decoration tests cannot see this:
// `buildDecorations` runs against a fake view. So build a real one.
//
// What this proves is that the extension is *configured* that way, plus that
// the attributes survive the trip to the DOM. The behaviour itself — where the
// caret lands in mixed text — needs a browser: happy-dom does no bidi layout.

function editor(doc: string): InstanceType<typeof EditorView> {
  return new EditorView({
    parent: document.body,
    // With the markdown language: without a parser there is no syntax tree,
    // and everything the preview derives from a block would be invisible here.
    state: EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: [mathBlock] }), livePreview()],
    }),
  });
}

test('livePreview reads direction per line and puts it on the rendered line', () => {
  const view = editor('Hello\nمرحبا');
  try {
    assert.equal(view.state.facet(EditorView.perLineTextDirection), true);
    const dirs = [...view.contentDOM.querySelectorAll('.cm-line')].map((l) => l.getAttribute('dir'));
    assert.deepEqual(dirs, ['ltr', 'rtl']);
  } finally {
    view.destroy();
  }
});

test('a table reaches the DOM as a table', () => {
  // The point of the widget: real rows and cells, so the columns line up
  // without the markdown being padded by hand, and a screen reader is handed a
  // table rather than a line of pipes.
  const view = editor('text\n\n| term | ترجمة |\n|:---|---:|\n| **book** | كتاب |');
  try {
    const table = view.contentDOM.querySelector('table.md-table')!;
    assert.ok(table, 'rendered as a table element');
    assert.equal(
      table.parentElement!.getAttribute('dir'), 'ltr',
      'the wrapper carries the direction, so the box starts at the right edge',
    );
    assert.deepEqual(
      [...table.querySelectorAll('thead th')].map((c) => c.textContent),
      ['term', 'ترجمة'],
    );
    assert.deepEqual(
      [...table.querySelectorAll('tbody td')].map((c) => c.textContent),
      ['book', 'كتاب'],
    );
    assert.deepEqual(
      [...table.querySelectorAll('thead th')].map((c) => (c as HTMLElement).style.textAlign),
      ['start', 'end'],
      'alignment comes from the delimiter row, logically so RTL mirrors it',
    );
    assert.equal(table.querySelector('tbody .md-strong')?.textContent, 'book', 'bold survives as a class');
    assert.equal(
      [...view.contentDOM.querySelectorAll('.cm-line')].filter((l) => l.textContent!.includes('|')).length,
      0,
      'the pipes are gone: the block is replaced, not decorated',
    );
  } finally {
    view.destroy();
  }
});

test('an Arabic table is placed from the right, not just mirrored inside', () => {
  // A table's own `dir` reorders its columns but does not move its box — the
  // box is placed by its parent, and .cm-content reads left-to-right. Without
  // the wrapper an Arabic table hugs the left edge with reversed columns.
  const view = editor('x\n\n| مصطلح | ترجمة |\n|---|---|\n| كتاب | book |');
  try {
    const wrap = view.contentDOM.querySelector('.md-table-wrap')!;
    assert.equal(wrap.getAttribute('dir'), 'rtl', 'the wrapper is what places it');
    assert.ok(wrap.querySelector('table.md-table'), 'the table sits inside the wrapper');
  } finally {
    view.destroy();
  }
});

test('a table past the first parse chunk renders without being touched', () => {
  // CodeMirror parses only the first few thousand characters up front and
  // finishes in the background. That transaction carries neither a document
  // change nor a selection, so a field watching only those two would leave a
  // table further down as raw pipes until something else redrew the editor.
  const filler = 'Some ordinary paragraph of prose.\n\n'.repeat(120);
  const view = editor(`${filler}| a | b |\n|---|---|\n| 1 | 2 |`);
  try {
    assert.ok(
      view.state.doc.length > 3000,
      'the table is past the initial parse window, or this proves nothing',
    );
    // Let the background parse land, then look without touching the editor.
    ensureSyntaxTree(view.state, view.state.doc.length, 5000);
    view.dispatch({});
    assert.ok(view.state.field(tableField).size > 0, 'the table is rendered');
  } finally {
    view.destroy();
  }
});

// KaTeX loads on first use, so the typeset block lands a few ticks after the
// editor is built. Until then the block holds its TeX as plain text.
async function typeset(view: InstanceType<typeof EditorView>): Promise<Element> {
  for (let tick = 0; tick < 100; tick++) {
    const math = view.contentDOM.querySelector('.md-math');
    if (math?.firstElementChild) return math;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('KaTeX never rendered');
}

test('the example from the issue reaches the DOM typeset, on two lines', async () => {
  const view = editor(String.raw`# temp

$$
\Omega = \{ (\omega_1 , \omega_2) \, | \, \omega \in \{1,2,3\} \}
\\
\Omega = \{ (1,2), (1,3), (2,1), (2,3), (3,1), (3,2) \}
$$`);
  try {
    const math = await typeset(view);
    assert.ok(math.querySelector('.katex'), 'typeset');
    assert.ok(!math.querySelector('.katex-error'), 'no parse error');
    assert.ok(math.querySelector('.katex-newline'), 'the `\\` breaks the line');
    assert.equal(math.getAttribute('dir'), 'ltr');
    assert.ok(
      ![...view.contentDOM.querySelectorAll('.cm-line')].some((l) => l.textContent!.includes('$$')),
      'the source is replaced, not decorated',
    );
  } finally {
    view.destroy();
  }
});

test('half-typed TeX shows as an error in place, not a crash', async () => {
  const view = editor('x\n\n$$\n\\frac{1}{\n$$');
  try {
    const math = await typeset(view);
    assert.ok(math.querySelector('.katex-error'), 'rendered as an error');
  } finally {
    view.destroy();
  }
});

test('tapping a formula opens its source', async () => {
  const view = editor('x\n\n$$\na^2\n$$');
  try {
    const math = await typeset(view);
    // On the formula, as a finger would be: a press on the box itself may be on
    // its scrollbar, which the widget leaves to scroll.
    math.querySelector('.katex')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    assert.equal(view.state.selection.main.head, 3, 'the caret is at the block');
    assert.equal(view.contentDOM.querySelector('.md-math'), null, 'and the source is back');
  } finally {
    view.destroy();
  }
});

// The TeX comes from other chat members, and typesetting blocks the UI thread.
function typesetInto(tex: string): HTMLElement {
  const el = document.createElement('div');
  render(katex, el, tex);
  return el;
}

test('a note cannot define macros, so a few bytes cannot become minutes of work', () => {
  // `\def\a{…}` and a thousand `\a`: 2 KB that took KaTeX 80 seconds to typeset.
  const bomb = `\\def\\a{${'x+'.repeat(150)}}${'\\a'.repeat(999)}`;
  for (const tex of [bomb, '\\newcommand{\\R}{\\mathbb{R}} x \\in \\R', '\\global\\let\\b=x \\b']) {
    const started = Date.now();
    const error = typesetInto(tex).querySelector('.katex-error');
    assert.ok(error, `${tex.slice(0, 30)}: shown as an error`);
    assert.match(error.getAttribute('title')!, /is off: a shared note cannot define macros/);
    assert.ok(Date.now() - started < 1000, 'and refused before any expansion work');
  }
  assert.ok(typesetInto('\\mathbb{R}^n').querySelector('.katex'), 'ordinary TeX still typesets');
});

test('a formula too long to typeset quickly stays as its source', () => {
  const tex = 'x+'.repeat(MAX_TEX / 2 + 1);
  const el = typesetInto(tex);
  assert.equal(el.textContent, tex);
  assert.equal(el.querySelector('.katex'), null);
});
