import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { EditorSelection, EditorState, Transaction, type Extension, type TransactionSpec } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { insertNewlineAndIndent } from '@codemirror/commands';
import type { Command, EditorView } from '@codemirror/view';
import {
  toggleBold,
  toggleItalic,
  toggleStrikethrough,
  toggleHighlight,
  toggleInlineCode,
  cycleHeading,
  toggleBullet,
  toggleChecklist,
  insertNewlineContinueMarkup,
} from './commands.ts';
import { mathBlock } from './live-preview/math.ts';
import { highlight } from './live-preview/highlight.ts';

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

// The inline toggles read the syntax tree, so the default is the app's parser.
const md = markdown({ base: markdownLanguage, extensions: [mathBlock] });

function run(cmd: Command, spec: string, extensions: Extension = md): Result {
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

// --- Inline toggles as a boolean operation on the styled text ----------------

const bold = (spec: string): string => show(run(toggleBold, spec));
const italic = (spec: string): string => show(run(toggleItalic, spec));
const strike = (spec: string): string => show(run(toggleStrikethrough, spec));

test('a selection inside bold text is cut out of it', () => {
  assert.equal(bold('**ein «langer» text**'), '**ein** «langer» **text**');
  assert.equal(bold('**«ein» langer**'), '«ein» **langer**');       // at the start
  assert.equal(bold('**ein «langer»**'), '**ein** «langer»');       // at the end
  assert.equal(bold('**a«b»c**'), '**a**«b»**c**');                 // inside a word
  assert.equal(bold('**ein «langer »text**'), '**ein** «langer »**text**'); // markers hug the words
  assert.equal(bold('«**ab**»'), '«ab»');                           // markers selected too
  assert.equal(bold('**a«b**»'), '**a**«b»');                       // closing marker selected
  assert.equal(bold('__ein «langer» text__'), '**ein** «langer» **text**'); // underscore form
});

test('a selection across the edge of bold text extends it', () => {
  assert.equal(bold('**fett «fett** normal» rest'), '**fett «fett normal»** rest');
  assert.equal(bold('rest «normal **fett» fett**'), 'rest **«normal fett» fett**');
  assert.equal(bold('**a** «b»'), '**a «b»**');                     // next to it: joins
  assert.equal(bold('«a» **b**'), '**«a» b**');
  assert.equal(bold('**a**«b»'), '**a«b»**');
  assert.equal(bold('**a** «b» **c**'), '**a «b» c**');             // bridges two
  assert.equal(bold('«x **a** y»'), '**«x a y»**');                 // swallows one
  assert.equal(bold('**a** x «b»'), '**a** x **«b»**');             // text between: stays apart
});

test('markers go around the words, not the selected spaces', () => {
  assert.equal(bold('a« b »c'), 'a« **b** »c');
  assert.equal(bold('a« »b'), 'a« »b');                              // nothing to make bold
});

test('several lines are styled one by one, outside their block markup', () => {
  // (A marker set right at an edge of the selection stays outside it: `»**`.)
  assert.equal(bold('- «eins\n- zwei»'), '- **«eins**\n- **zwei»**');
  assert.equal(bold('«- eins\n- zwei»'), '«- **eins**\n- **zwei»**');
  assert.equal(bold('«- [ ] a\n- [x] b»'), '«- [ ] **a**\n- [x] **b»**');
  assert.equal(bold('«1. a\n2. b»'), '«1. **a**\n2. **b»**');
  assert.equal(bold('«- a\n  - b»'), '«- **a**\n  - **b»**');
  assert.equal(bold('«> a\n> b»'), '«> **a**\n> **b»**');
  assert.equal(bold('«# a\nb»'), '«# **a**\n**b»**');
  assert.equal(bold('«a\n\nb»'), '**«a**\n\n**b»**');              // blank line stays blank
  assert.equal(bold('«| a | b |\n|---|---|\n| c | d |»'),
    '«| **a** | **b** |\n|---|---|\n| **c** | **d** |»');
});

test('a mixed selection becomes bold first, and normal only once all of it is bold', () => {
  assert.equal(bold('«- **a**\n- b»'), '«- **a**\n- **b»**');
  assert.equal(bold('«- **a**\n- **b**»'), '«- a\n- b»');
  assert.equal(bold('«**a** **b**»'), '«a b»');
});

test('italic and strikethrough work the same way', () => {
  assert.equal(italic('*ein «langer» text*'), '*ein* «langer» *text*');
  assert.equal(italic('*a «b* c»'), '*a «b c»*');
  assert.equal(italic('_a «b_ c»'), '*a «b c»*');
  assert.equal(strike('«ab»'), '~~«ab»~~');
  assert.equal(strike('~~«ab»~~'), '«ab»');
  assert.equal(strike('~~ein «langer» text~~'), '~~ein~~ «langer» ~~text~~');
  assert.equal(strike('~~a «b~~ c»'), '~~a «b c»~~');
  assert.equal(strike('- «a\n- b»'), '- ~~«a~~\n- ~~b»~~');
  assert.equal(strike('a|b'), 'a~~|~~b');
});

const mark = (spec: string): string =>
  show(run(toggleHighlight, spec, markdown({ base: markdownLanguage, extensions: [mathBlock, highlight] })));

test('highlight follows the highlighted text as the other styles do', () => {
  assert.equal(mark('«ab»'), '==«ab»==');
  assert.equal(mark('==«ab»=='), '«ab»');
  assert.equal(mark('==ein «langer» text=='), '==ein== «langer» ==text==');
  assert.equal(mark('==a «b== c»'), '==a «b c»==');
  assert.equal(mark('- «a\n- b»'), '- ==«a==\n- ==b»==');
  // An empty one, with the caret inside, for the color menu to fill.
  assert.equal(mark('a |b'), 'a ==|==b');
  assert.equal(mark('**«ab»**'), '**==«ab»==**');
  // Cut in two, a colored highlight keeps its color on both sides.
  assert.equal(mark('==🔴ein «langer» text=='), '==🔴ein== «langer» ==🔴text==');
  assert.equal(mark('==🔴ein «langer»=='), '==🔴ein== «langer»');
  // Its emoji goes with it when it is removed, rather than stay as text.
  assert.equal(mark('«==🔴ab==»'), '«ab»');
  assert.equal(mark('==🔴«ab»=='), '«ab»');
  assert.equal(mark('==🔴«ein» langer=='), '«ein» ==🔴langer==');
});

test('bold and italic nest without disturbing each other', () => {
  assert.equal(italic('**«ab»**'), '***«ab»***');
  assert.equal(italic('«**ab**»'), '*«**ab**»*');
  assert.equal(bold('*«ab»*'), '***«ab»***');
  assert.equal(italic('***«ab»***'), '**«ab»**');
  assert.equal(bold('***«ab»***'), '*«ab»*');
  assert.equal(bold('*a «b» c*'), '*a **«b»** c*');
  assert.equal(italic('**a «b» c**'), '**a *«b»* c**');
  assert.equal(bold('**a *b «c* d** e»'), '**a *b «c* d e»**');
  // Across the edge of the other style: one piece on each side of it.
  assert.equal(italic('**a «b** c»'), '**a *«b*** *c»*');
  assert.equal(italic('***a «b»***'), '***a* «b»**');
});

test('markers stay where markdown reads them as markers', () => {
  // Between a word and punctuation a marker is literal, so punctuation at the
  // edge of a run stays outside it.
  assert.equal(bold('**«Note», this** end'), '«Note», **this** end');
  assert.equal(bold('**Hello «world»!** end'), '**Hello** «world»! end');
  assert.equal(bold('foo«(bar)»'), 'foo«(**bar)»**');
  assert.equal(bold('foo«(**bar**)»'), 'foo«(bar)»');                // and comes off again
  assert.equal(bold('«(bar)»'), '**«(bar)»**');                      // no word outside: all of it
  assert.equal(italic('*see «this», ok*'), '*see* «this», *ok*');
  assert.equal(strike('a«(b)»c'), 'a«(~~b~~)»c');
  // A hard break's backslash would escape the closing marker.
  assert.equal(bold('«a\\\nb»'), '**«a**\\\n**b»**');
  // A literal marker character in the text is escaped, not paired up.
  assert.equal(italic('«2*3»'), '*«2\\*3»*');
  assert.equal(italic('*«2\\*3»*'), '«2\\*3»');
  assert.equal(bold('«a `*` $*$ b»'), '**«a `*` $*$ b»**');           // not in code or math
  assert.equal(bold('«- [ ]\n- x»'), '«- [ ]\n- **x»**');            // an empty task is no text
  assert.equal(bold('a <!-- «c» --> b'), 'a **<!-- «c» -->** b');
  assert.equal(bold('1 \\«* 2»'), '1 **\\«* 2»**');                    // an escape stays whole
  assert.equal(bold('«a \\\\* b»'), '**«a \\\\\\* b»**');              // `\\\\` is a backslash, the `*` literal
  // Punctuation that belongs to other markup is not shed.
  assert.equal(bold('**a «b»~~c~~**'), '**a** «b»**~~c~~**');
  assert.equal(bold('wow«! 😀»'), 'wow«! **😀»**');
  assert.equal(bold('wow«! **😀»**'), 'wow«! 😀»');
});

test('code, math and link targets are never split by a marker', () => {
  assert.equal(bold('a `b«c` d»'), 'a **`b«c` d»**');               // whole code span
  assert.equal(bold('a $b«c$ d»'), 'a **$b«c$ d»**');
  assert.equal(bold('[te«xt](url) more»'), '**[te«xt](url) more»**');
  assert.equal(bold('[a «b» c](url)'), '[a **«b»** c](url)');       // inside the link text
  assert.equal(bold('**see [«text»](url) now**'), '**see** [«text»](url) **now**');
  assert.equal(bold('**a [b«c»](u)**'), '**a** [**b**«c»](u)');
  assert.equal(bold('**[«text»](url)**'), '[«text»](url)');
  assert.equal(bold('«a\n```\ncode\n```\nb»'), '**«a**\n```\ncode\n```\n**b»**');
  assert.equal(bold('```\n«code»\n```'), '```\n«code»\n```');
});

// Enter as the keymap runs it: ours first, then defaultKeymap's plain newline
// if ours declines. Cursors are `|`; several may be given.
function enter(spec: string): string {
  const parts = spec.split('|');
  const cursors = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('').length);
  let state = EditorState.create({
    doc: parts.join(''),
    selection: EditorSelection.create(cursors.map((c) => EditorSelection.cursor(c))),
    extensions: [EditorState.allowMultipleSelections.of(true), markdown({ base: markdownLanguage })],
  });
  const view = { get state() { return state; }, dispatch(tr: Transaction) { state = tr.state; } } as unknown as EditorView;
  if (!insertNewlineContinueMarkup(view)) insertNewlineAndIndent(view);
  const doc = state.doc.toString();
  return state.selection.ranges.reduceRight((out, r) => out.slice(0, r.head) + '|' + out.slice(r.head), doc);
}

test('Enter keeps the text of a continuation line under an empty task item', () => {
  // lang-markdown saw ` 2,5h` as an empty item (sliced past the `- [ ] ` width)
  // and Enter deleted it, leaving `- [ ] \n|  `. Now it's a plain newline.
  assert.equal(enter('- [ ] \n 2,5h|  '), '- [ ] \n 2,5h\n |');
  assert.equal(enter('- [ ] \n 2,5h  |'), '- [ ] \n 2,5h  \n |');
  assert.equal(enter('- [ ] task\n  abc|'), '- [ ] task\n  abc\n  |'); // aligned, but ends before col 6
  // Text that looks like markup is still text: `2026.` is not an item marker.
  assert.equal(enter('- [ ] Pay\n 2026.|'), '- [ ] Pay\n 2026.\n |');
  assert.equal(enter('- [ ] buy\n 3.5)|'), '- [ ] buy\n 3.5)\n |');
  assert.equal(enter('- [ ] a\n  [x]|'), '- [ ] a\n  [x]\n  |');
});

test('Enter keeps short continuation lines under any list marker', () => {
  // Same upstream slice, other markers: each of these used to lose its text.
  assert.equal(enter('- a\n b|'), '- a\n b\n |');           // plain bullet
  assert.equal(enter('- \n x|'), '- \n x\n |');             // empty bullet
  assert.equal(enter('* [ ] \n 2,5h|'), '* [ ] \n 2,5h\n |'); // other bullet char
  assert.equal(enter('- [x] \n 2,5h|'), '- [x] \n 2,5h\n |'); // checked box
  assert.equal(enter('1. \n x|'), '1. \n x\n |');           // ordered
  assert.equal(enter('1. [ ] a\n b|'), '1. [ ] a\n b\n |'); // ordered task
});

test('Enter keeps a short nested item whose marker is followed by a tab', () => {
  // Upstream only recognises `- ` (space), so a `-\t` item fell back to the
  // outer `- [ ] ` width and its text was deleted.
  assert.equal(enter('- [ ] a\n  -\tx|'), '- [ ] a\n  -\tx\n  |');
  assert.equal(enter('- [ ] a\n  -\tb|c'), '- [ ] a\n  -\tb\n  |c');
});

test('Enter keeps text in a blockquote after an empty quoted line', () => {
  // Upstream's "two empty quoted lines" exit misjudged these the same way.
  assert.equal(enter('   > a\n   >\n   >b|'), '   > a\n   >\n   >b\n   |');
  assert.equal(enter('   > a\n   >\n>-\tb|'), '   > a\n   >\n>-\tb\n|');
});

test('Enter checks every cursor, not just the main one', () => {
  assert.equal(enter('- [ ] a|\n- [ ] \n 2,5h|'), '- [ ] a\n|\n- [ ] \n 2,5h\n |');
  // One cursor's deletion abuts the other's newline; checked separately too.
  assert.equal(enter('>- [ ] a\n> 1. [ ] \np|ara|'), '>- [ ] a\n> 1. [ ] \np\n|ara\n|');
});

test('Enter still continues and exits lists and quotes', () => {
  assert.equal(enter('- [ ] a|'), '- [ ] a\n- [ ] |');                 // next task
  assert.equal(enter('- [x] a|'), '- [x] a\n- [ ] |');                 // next task is unticked
  assert.equal(enter('- [ ] 2,|5h'), '- [ ] 2,\n- [ ] |5h');           // split mid-line
  assert.equal(enter('1. a|'), '1. a\n2. |');                          // numbering
  assert.equal(enter('1. a\n2. |\n3. b'), '1. a\n|\n2. b');            // exit renumbers the rest
  assert.equal(enter('- [ ] \n      2,5h|'), '- [ ] \n      2,5h\n      |'); // aligned continuation
  assert.equal(enter('> a|'), '> a\n> |');                             // blockquote
  // Empty items (markup only) still exit, one level at a time.
  assert.equal(enter('- [ ] a\n- [ ] |'), '- [ ] a\n|');
  assert.equal(enter('- |'), '|');
  assert.equal(enter('1. a\n2. |'), '1. a\n|');
  assert.equal(enter('- a\n  - |'), '- a\n- |');
  assert.equal(enter('- a\n  - b\n  - |'), '- a\n  - b\n- |');
  assert.equal(enter('> - \n> |'), '> - \n>\n> |');
  assert.equal(enter('> a\n>\n>|'), '> a\n\n|');
  // Outside list and quote markup it's the plain newline.
  assert.equal(enter('plain|'), 'plain\n|');
});
