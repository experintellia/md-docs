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
const { render, MAX_TEX, typeset: typesetMath } = await import('./widgets/math.ts');
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

test('`\\tag` and `\\nonumber` stay refused: they would define a macro a note can call', () => {
  // KaTeX implements both with an internal `\gdef\df@tag{…}`, and `\df@tag`
  // can be typed: `\tag{\df@tag\df@tag…}` is the macro blow-up the ban is for.
  for (const tex of ['E = mc^2 \\tag{1}', '\\begin{align} a &= b \\nonumber \\\\ c &= d \\end{align}']) {
    const error = typesetInto(tex).querySelector('.katex-error')?.getAttribute('title');
    assert.match(error ?? '', /cannot define macros/, tex);
  }
});

test('deeply nested TeX is refused or typeset quickly, not seconds of work', () => {
  // 4.5 KB, under MAX_TEX: four seconds in Chromium, on every peer, each time
  // it scrolls into view — and a line or a table can hold any number of them.
  const tex = `${'\\cancel{'.repeat(500)}x${'}'.repeat(500)}`;
  const started = performance.now();
  typesetInto(tex);
  const ms = performance.now() - started;
  assert.ok(ms < 2000, `${Math.round(ms)} ms`);
});

test('only real nesting counts against the depth limit', () => {
  // `\leftarrow` is not `\left`, and `\{` opens no group.
  for (const tex of ['\\leftarrow '.repeat(60), '\\{'.repeat(60), `${'{'.repeat(40)}x${'}'.repeat(40)}`]) {
    assert.equal(typesetInto(tex).title, '', tex.slice(0, 20));
  }
  assert.match(typesetInto(`${'\\left('.repeat(60)}x${'\\right)'.repeat(60)}`).title, /Nested too deeply/);
});

// Wait for the lazy KaTeX import that `typeset` starts.
async function katexLoaded(): Promise<void> {
  const el = document.createElement('span');
  typesetMath({} as InstanceType<typeof EditorView>, el, 'x', false);
  for (let tick = 0; tick < 100 && !el.firstElementChild; tick++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

// How much TeX, in characters, `run` hands KaTeX — counted, not typeset.
async function texTypeset(run: () => void): Promise<number> {
  await katexLoaded();
  const real = katex.render;
  let chars = 0;
  katex.render = (tex: string) => { chars += tex.length; };
  try {
    run();
  } finally {
    katex.render = real;
  }
  return chars;
}

// 300 formulas of 400 characters: pasted in, Chromium typeset all of them in
// one go (6 s, the page frozen), where 300 `$$` blocks typeset only the dozen
// in view. MAX_TEX bounds one formula; nothing bounds a line or a table.
const FORMULA = `$${'x+'.repeat(200)}x$`;

test('one table typesets a bounded amount of TeX, however many formulas it holds', async () => {
  let view: InstanceType<typeof EditorView> | undefined;
  const chars = await texTypeset(() => {
    view = editor(`x\n\n| a |\n|---|\n${`| ${FORMULA} |\n`.repeat(300)}\nend`);
  });
  try {
    assert.ok(view!.contentDOM.querySelector('.md-table'), 'the table is rendered');
    assert.ok(chars <= 2 * MAX_TEX, `${chars} characters typeset at once`);
  } finally {
    view!.destroy();
  }
});

test('one line typesets a bounded amount of TeX, however many formulas it holds', async () => {
  let view: InstanceType<typeof EditorView> | undefined;
  const chars = await texTypeset(() => {
    view = editor(`x\n\n${`${FORMULA} `.repeat(300)}\n\nend`);
  });
  try {
    assert.ok(chars > 0, 'some of it is typeset');
    assert.ok(chars <= 2 * MAX_TEX, `${chars} characters typeset at once`);
  } finally {
    view!.destroy();
  }
});

test('math in a table cell is locked down as a block is', async () => {
  await katexLoaded();
  const cells = [
    '\\href{javascript:alert(1)}{a}', '\\url{javascript:alert(1)}', '\\includegraphics{http://evil.example/x.png}',
    '\\htmlId{evil}{x}', '\\htmlClass{evil}{x}', '\\htmlStyle{position:fixed}{x}', '\\text{<img src=x>}',
    '\\def\\a{x}\\a',
  ];
  const view = editor(`x\n\n| a |\n|---|\n${cells.map((tex) => `| $${tex}$ |\n`).join('')}\nend`);
  try {
    const table = view.contentDOM.querySelector('.md-table')!;
    assert.equal(table.querySelectorAll('.md-math-inline').length, cells.length, 'every cell is typeset');
    assert.equal(table.querySelector('a, img, #evil, .evil, [style*="fixed"]')?.outerHTML, undefined);
    assert.match(table.querySelector('.katex-error')?.getAttribute('title') ?? '', /cannot define macros/);
  } finally {
    view.destroy();
  }
});

test('a task checkbox ticks once per press, and keeps keyboard focus', () => {
  const view = editor('first\n- [ ] task');
  try {
    const box = view.contentDOM.querySelector<HTMLInputElement>('.md-task-checkbox')!;
    assert.equal(box.getAttribute('aria-label'), 'Done');
    const click = (): boolean => box.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    // Space on the focused box: a click alone.
    box.focus();
    click();

    assert.equal(view.state.doc.toString(), 'first\n- [x] task');
    assert.ok(view.contentDOM.querySelector('.md-task-checkbox') === box, 'the same box, updated');
    assert.equal(box.checked, true);
    assert.ok(document.activeElement === box, 'focus stays, so Space can untick it');
    click();
    assert.equal(view.state.doc.toString(), 'first\n- [ ] task');
    // A tap or a screen reader's activation: mousedown, then click. Once.
    box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    click();
    assert.equal(view.state.doc.toString(), 'first\n- [x] task');
  } finally {
    view.destroy();
  }
});
