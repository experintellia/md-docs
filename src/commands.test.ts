import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { EditorState, Transaction, type TransactionSpec } from '@codemirror/state';
import type { Command, EditorView } from '@codemirror/view';
import {
  toggleBold,
  toggleItalic,
  toggleInlineCode,
  cycleHeading,
  toggleBullet,
  toggleChecklist,
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

function run(cmd: Command, spec: string): Result {
  const { doc, selection } = parse(spec);
  let state = EditorState.create({ doc, selection });
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
