import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { EditorState, Transaction, type Extension, type TransactionSpec } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import type { Command, EditorView } from '@codemirror/view';
import {
  toggleBold,
  toggleItalic,
  toggleInlineCode,
  cycleHeading,
  toggleBullet,
  toggleChecklist,
  insertNewlineContinueMarkup,
} from './commands.ts';

// Tier 2: toolbar command behaviour. The commands only read `view.state` and
// call `view.dispatch`, never the DOM — so a minimal state+dispatch stand-in
// exercises every scenario headlessly (no jsdom). `|` in a doc string marks the
// cursor; `«` ... `»` marks a selection range (guillemets so they don't clash
// with markdown's own `[ ]` checkboxes and `[text](url)` links).

interface Result {
  doc: string;
  anchor: number;
  head: number;
}

// Parse a doc string with a cursor `|` or a selection `«`...`»` into text + selection.
function parse(spec: string): { doc: string; selection: { anchor: number; head?: number } } {
  if (spec.includes('«')) {
    const anchor = spec.indexOf('«');
    const head = spec.indexOf('»') - 1; // account for the removed '«'
    const doc = spec.replace('«', '').replace('»', '');
    return { doc, selection: { anchor, head } };
  }
  const pos = spec.indexOf('|');
  return { doc: spec.replace('|', ''), selection: { anchor: pos } };
}

function run(cmd: Command, spec: string, extensions: Extension = []): Result {
  const { doc, selection } = parse(spec);
  let state = EditorState.create({ doc, selection, extensions });
  const view = {
    get state() {
      return state;
    },
    dispatch(tr: Transaction | TransactionSpec) {
      // Commands pass either a Transaction or a spec to update() — handle both.
      state = tr instanceof Transaction ? tr.state : state.update(tr).state;
    },
  } as unknown as EditorView;
  cmd(view);
  const { anchor, head } = state.selection.main;
  return { doc: state.doc.toString(), anchor, head };
}

// Render a Result back into the `|` / `«»` notation for readable assertions.
function show({ doc, anchor, head }: Result): string {
  if (anchor === head) return doc.slice(0, head) + '|' + doc.slice(head);
  const [from, to] = anchor < head ? [anchor, head] : [head, anchor];
  return doc.slice(0, from) + '«' + doc.slice(from, to) + '»' + doc.slice(to);
}

test('toggleBold wraps, unwraps, and parks the cursor', () => {
  assert.equal(show(run(toggleBold, 'a|b')), 'a**|**b');      // collapsed: markers + cursor between
  assert.equal(show(run(toggleBold, '«ab»')), '**«ab»**');    // selection: wrap, keep selected
  assert.equal(show(run(toggleBold, '**«ab»**')), '«ab»');    // already bold: unwrap
});

test('toggleItalic and toggleInlineCode use their markers', () => {
  assert.equal(run(toggleItalic, '«ab»').doc, '*ab*');
  assert.equal(run(toggleItalic, '*«ab»*').doc, 'ab');
  assert.equal(run(toggleInlineCode, '«ab»').doc, '`ab`');
  assert.equal(run(toggleInlineCode, '`«ab»`').doc, 'ab');
});

test('cycleHeading cycles none -> H1 -> H2 -> H3 -> none', () => {
  assert.equal(run(cycleHeading, 'hi|').doc, '# hi');
  assert.equal(run(cycleHeading, '# hi|').doc, '## hi');
  assert.equal(run(cycleHeading, '## hi|').doc, '### hi');
  assert.equal(run(cycleHeading, '### hi|').doc, 'hi'); // wraps back to none
});

test('cycleHeading only touches the line the cursor is on', () => {
  assert.equal(run(cycleHeading, 'one\ntw|o').doc, 'one\n# two');
});

test('cycleHeading on a blank line parks the cursor after the marker', () => {
  assert.equal(show(run(cycleHeading, '|')), '# |');          // empty line -> behind "# "
  assert.equal(show(run(cycleHeading, 'a\n|')), 'a\n# |');    // empty line below text
  assert.equal(show(run(cycleHeading, 'hi|')), '# hi|');      // non-empty: cursor stays on the text
});

test('toggleBullet adds and removes a bullet, preserving indent', () => {
  assert.equal(show(run(toggleBullet, 'hi|')), '- |hi'); // cursor parks after the marker
  assert.equal(run(toggleBullet, '- hi|').doc, 'hi');   // existing bullet removed
  assert.equal(run(toggleBullet, '  hi|').doc, '  - hi'); // indent kept
});

test('toggleChecklist: plain -> task, bullet -> task, then ticks/unticks', () => {
  assert.equal(show(run(toggleChecklist, 'hi|')), '- [ ] |hi');     // plain line, cursor after marker
  assert.equal(run(toggleChecklist, '- hi|').doc, '- [ ] hi');      // bullet gains a box
  assert.equal(run(toggleChecklist, '- [ ] hi|').doc, '- [x] hi');  // tick
  assert.equal(run(toggleChecklist, '- [x] hi|').doc, '- [ ] hi');  // untick
  assert.equal(run(toggleChecklist, '- [X] hi|').doc, '- [ ] hi');  // capital X unticks
});

test('toggleBullet on a task item converts it to a plain bullet', () => {
  assert.equal(run(toggleBullet, '- [ ] hi|').doc, '- hi');     // unchecked box -> bullet
  assert.equal(run(toggleBullet, '- [x] hi|').doc, '- hi');     // checked box too
  assert.equal(run(toggleBullet, '  - [ ] hi|').doc, '  - hi'); // indentation kept
  assert.equal(run(toggleBullet, '* [ ] hi|').doc, '* hi');     // other bullet chars
});

test('bullet <-> checklist convert into each other (toolbar buttons are inverses)', () => {
  assert.equal(run(toggleChecklist, '- hi|').doc, '- [ ] hi'); // list -> checkbox
  assert.equal(run(toggleBullet, '- [ ] hi|').doc, '- hi');    // checkbox -> list
});

// --- Edge cases -------------------------------------------------------------

test('an empty task item (no trailing space) ticks instead of doubling the box', () => {
  // `- [ ]` at the end of a line has no space after the bracket. Requiring one
  // made toggleChecklist fall through to the "bullet" branch and insert a
  // SECOND checkbox (`- [ ] [ ]`), and toggleBullet strip the bullet instead
  // of the box (`[ ]`).
  assert.equal(run(toggleChecklist, '- [ ]|').doc, '- [x]');
  assert.equal(run(toggleChecklist, '- [x]|').doc, '- [ ]');
  assert.equal(run(toggleBullet, '- [ ]|').doc, '- ');
  assert.equal(run(toggleBullet, '  - [x]|').doc, '  - '); // indent kept
});

test('a tab after the checkbox is a task marker too (GFM allows it)', () => {
  assert.equal(run(toggleChecklist, '- [ ]\thi|').doc, '- [x]\thi');
  assert.equal(run(toggleBullet, '- [ ]\thi|').doc, '- hi'); // box + tab removed
});

test('`- [ ]x` is not a task marker (needs a space or the line end after it)', () => {
  assert.equal(run(toggleBullet, '- [ ]x|').doc, '[ ]x'); // plain bullet, box is text
});

test('toggleWrap at the document edges wraps without reading out of bounds', () => {
  // range.from - 2 is negative at position 0, range.to + 2 past the end at the
  // last position; sliceDoc must be allowed to clamp rather than mis-detect.
  assert.equal(show(run(toggleBold, '|ab')), '**|**ab');
  assert.equal(show(run(toggleBold, 'ab|')), 'ab**|**');
  assert.equal(show(run(toggleBold, '«ab»')), '**«ab»**');
});

test('cycleHeading resets H4-H6 (typed by hand) back to plain text', () => {
  assert.equal(run(cycleHeading, '#### hi|').doc, 'hi');
  assert.equal(run(cycleHeading, '###### hi|').doc, 'hi');
  // Seven hashes is not a heading at all, so it gains one.
  assert.equal(run(cycleHeading, '####### hi|').doc, '# ####### hi');
});

test('toggleChecklist keeps indentation when creating a task', () => {
  assert.equal(show(run(toggleChecklist, '  hi|')), '  - [ ] |hi');
  assert.equal(show(run(toggleChecklist, '  * hi|')), '  * [ ] |hi');
});

const enter = (spec: string) =>
  show(run(insertNewlineContinueMarkup, spec, markdown({ base: markdownLanguage })));

test('Enter keeps the text of a continuation line under an empty task item', () => {
  // lang-markdown saw ` 2,5h` as an empty item (sliced past the `- [ ] ` width)
  // and Enter deleted it, leaving `- [ ] \n|  `.
  // Now declined (doc untouched), so the defaultKeymap's plain newline runs.
  assert.equal(enter('- [ ] \n 2,5h|  '), '- [ ] \n 2,5h|  ');
  assert.equal(enter('- [ ] \n 2,5h  |'), '- [ ] \n 2,5h  |');
  assert.equal(enter('- [ ] a\n b|'), '- [ ] a\n b|');
});

test('Enter keeps short continuation lines under any list marker', () => {
  // Same upstream slice, other markers: each of these used to lose its text.
  assert.equal(enter('- a\n b|'), '- a\n b|');           // plain bullet
  assert.equal(enter('- \n x|'), '- \n x|');             // empty bullet
  assert.equal(enter('* [ ] \n 2,5h|'), '* [ ] \n 2,5h|'); // other bullet char
  assert.equal(enter('- [x] \n 2,5h|'), '- [x] \n 2,5h|'); // checked box
  assert.equal(enter('1. \n x|'), '1. \n x|');           // ordered
  assert.equal(enter('1. [ ] a\n b|'), '1. [ ] a\n b|'); // ordered task
});

test('Enter still continues and exits lists and quotes', () => {
  assert.equal(enter('- [ ] a|'), '- [ ] a\n- [ ] |');                 // next task
  assert.equal(enter('- [x] a|'), '- [x] a\n- [ ] |');                 // next task is unticked
  assert.equal(enter('- [ ] 2,|5h'), '- [ ] 2,\n- [ ] |5h');           // split mid-line
  assert.equal(enter('1. a|'), '1. a\n2. |');                          // numbering
  assert.equal(enter('- [ ] \n      2,5h|'), '- [ ] \n      2,5h\n      |'); // aligned continuation
  assert.equal(enter('> a|'), '> a\n> |');                             // blockquote
  // Empty items (markup only) still exit, one level at a time.
  assert.equal(enter('- [ ] a\n- [ ] |'), '- [ ] a\n|');
  assert.equal(enter('- |'), '|');
  assert.equal(enter('1. a\n2. |'), '1. a\n|');
  assert.equal(enter('- a\n  - |'), '- a\n- |');
  assert.equal(enter('> - \n> |'), '> - \n>\n> |');
  // Outside markdown markup it declines, leaving Enter to the defaultKeymap.
  assert.equal(enter('plain|'), 'plain|');
});
