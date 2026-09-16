import { test, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();
const { EditorState } = await import('@codemirror/state');
const { EditorView } = await import('@codemirror/view');
const { livePreview } = await import('./index.ts');
const { markdown, markdownLanguage } = await import('@codemirror/lang-markdown');
const { ensureSyntaxTree } = await import('@codemirror/language');
const { tableField } = await import('./decorations.ts');
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
      extensions: [markdown({ base: markdownLanguage }), livePreview()],
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
