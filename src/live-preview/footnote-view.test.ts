import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { footnote, footnoteIndex } from './footnote.ts';
import { highlight } from './highlight.ts';
import { colorMenuAt } from './highlight-menu.ts';
import { buildDecorations, buildFootnoteList, buildTables } from './decorations.ts';
import { FootnoteListWidget, FootnoteRefWidget } from './widgets/footnote.ts';
import { TableWidget } from './widgets/table.ts';

// What the live preview makes of footnotes and highlights beyond the parser:
// read mode's numbering and list, table cells, and the highlight color menu.

function state(doc: string, opts: { cursor?: number; readOnly?: boolean } = {}): EditorState {
  const s = EditorState.create({
    doc,
    selection: { anchor: opts.cursor ?? doc.length },
    extensions: [
      markdown({ base: markdownLanguage, extensions: [footnote, highlight] }),
      EditorState.readOnly.of(opts.readOnly ?? false),
    ],
  });
  ensureSyntaxTree(s, s.doc.length, 5000);
  return s;
}

// Every widget of a decoration set, in document order.
function widgets(set: ReturnType<typeof buildTables>, s: EditorState): unknown[] {
  const out: unknown[] = [];
  set.between(0, s.doc.length, (_f, _t, deco) => {
    const widget = (deco.spec as { widget?: unknown }).widget;
    if (widget) out.push(widget);
  });
  return out;
}

const decorations = (s: EditorState): ReturnType<typeof buildTables> =>
  buildDecorations({ state: s, visibleRanges: [{ from: 0, to: s.doc.length }] } as unknown as EditorView);

test('footnotes are numbered by first reference, named and inline ones alike', () => {
  const doc = 'x[^b] y[^a] z[^b] w^[inline] v[^none]\n\n[^a]: A\n[^b]: B\n[^unused]: U';
  const index = footnoteIndex(state(doc));
  assert.deepEqual(index.notes.map((note) => [note.n, doc.slice(note.body.from, note.body.to)]),
    [[1, '[^b]: B'], [2, '[^a]: A'], [3, '^[inline]']]);
  // Each reference to `b` is 1; `[^none]` is defined nowhere and gets nothing.
  assert.deepEqual([...index.numberAt.values()], [1, 2, 1, 3]);
  assert.equal(index.allDefs.length, 3, 'the unused definition is still a definition');
});

test('read mode: references become numbers, definitions leave, a list ends the document', () => {
  const doc = 'see[^n] and^[in **place**]\n\n[^n]: the *note*\n  goes on\n\nend';
  const s = state(doc, { readOnly: true });
  const refs = widgets(decorations(s), s).filter((w) => w instanceof FootnoteRefWidget) as FootnoteRefWidget[];
  assert.deepEqual(refs.map((w) => w.n), [1, 2]);

  const list = buildFootnoteList(s);
  const hidden: string[] = [];
  let listed: FootnoteListWidget | undefined;
  list.between(0, s.doc.length, (from, to, deco) => {
    const widget = (deco.spec as { widget?: unknown }).widget;
    if (widget instanceof FootnoteListWidget) listed = widget;
    else hidden.push(doc.slice(from, to));
  });
  assert.deepEqual(hidden, ['\n[^n]: the *note*\n  goes on'], 'the whole definition, and the blank line above it');
  assert.ok(listed, 'the list is drawn');
  const text = listed!.notes.map((note) => note.segments.map((seg) => seg.text).join('').replace(/\s+/g, ' ').trim());
  assert.deepEqual(text, ['the note goes on', 'in place']);
  assert.ok(listed!.notes[0]!.segments.some((seg) => seg.cls === 'md-emphasis' && seg.text === 'note'));
  assert.equal(listed!.notes[0]!.ref, doc.indexOf('[^n]'), 'the way back is the first reference');
});

test('while editing there is no list, and the definition stays', () => {
  const s = state('see[^n]\n\n[^n]: note\n\nend');
  assert.equal(buildFootnoteList(s).size, 0);
  assert.equal(widgets(decorations(s), s).filter((w) => w instanceof FootnoteRefWidget).length, 0);
});

test('a reference off the caret line can be followed; on it, it cannot', () => {
  const doc = 'see[^n]\n\n[^n]: note\n\nend';
  const attrs = (s: EditorState): (string | undefined)[] => {
    const out: (string | undefined)[] = [];
    decorations(s).between(0, s.doc.length, (_f, _t, deco) => {
      const spec = deco.spec as { class?: string; attributes?: Record<string, string> };
      if (spec.class === 'md-footnote-ref') out.push(spec.attributes?.['data-fn-label']);
    });
    return out;
  };
  assert.deepEqual(attrs(state(doc)), ['n']);
  assert.deepEqual(attrs(state(doc, { cursor: 2 })), [undefined]);
  assert.deepEqual(attrs(state('see[^gone]\n\nend')), [undefined], 'nothing to go to');
});

function table(doc: string, readOnly = false): TableWidget {
  const s = state(doc, { readOnly });
  return widgets(buildTables(s), s).find((w) => w instanceof TableWidget) as TableWidget;
}

test('a table cell draws a colored highlight without its emoji', () => {
  const cell = table('| a |\n|---|\n| ==🔴x== and ==y== |\n\nend').spec.rows[0]![0]!;
  assert.deepEqual(cell.map((seg) => [seg.text, seg.cls]),
    [['x', 'md-highlight md-highlight-red'], [' and ', undefined], ['y', 'md-highlight']]);
});

test('a table cell reference is a superscript label, and in read mode its number', () => {
  const doc = 'first[^z]\n\n| a |\n|---|\n| y[^b] z[^z] |\n\n[^b]: B\n[^z]: Z';
  const edit = table(doc).spec.rows[0]![0]!.filter((seg) => seg.fn);
  assert.deepEqual(edit.map((seg) => [seg.text, seg.cls, seg.fn]),
    [['b', 'md-footnote-ref', { label: 'b', n: null }], ['z', 'md-footnote-ref', { label: 'z', n: null }]]);
  const read = table(doc, true);
  assert.deepEqual(read.spec.rows[0]![0]!.filter((seg) => seg.fn).map((seg) => seg.text), ['2', '1']);
  // A renumbering redraws the table even though its own source is the same.
  assert.ok(!read.eq(table(`x[^b] ${doc}`, true)));
});

test('the color menu opens right after an opening ==', () => {
  const at = (doc: string, cursor = doc.length): number | null => colorMenuAt(state(doc, { cursor }));
  assert.equal(at('a =='), 4, 'just typed, after a space');
  assert.equal(at('=='), 2, 'at the start of the line');
  assert.equal(at('(=='), 3, 'after punctuation');
  assert.equal(at('====', 2), 2, 'inside the empty pair the toolbar inserts');
  assert.equal(at('==x== b', 2), 2, 'at the opening == of a highlight');
});

test('the color menu stays shut where no color can go', () => {
  const at = (doc: string, cursor = doc.length, readOnly = false): number | null =>
    colorMenuAt(state(doc, { cursor, readOnly }));
  assert.equal(at('==x=='), null, 'after a closing ==');
  assert.equal(at('==🔴x==', 2), null, 'a color is already there');
  assert.equal(at('a=='), null, 'after a letter: a closing == or an operator');
  assert.equal(at('a ==='), null, 'a === run');
  assert.equal(at('a ==\n', 4), 4);
  assert.equal(at('a ===x', 4), null, 'the first two of a === run');
  assert.equal(at(String.raw`a \==`), null, 'escaped');
  assert.equal(at('`a ==`', 5), null, 'in code');
  assert.equal(at('```\na ==\n```', 8), null, 'in a fence');
  assert.equal(at('a ==', 4, true), null, 'in read mode');
});
