import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { buildDecorations, buildTables, lineDirection } from './decorations.ts';
import { CheckboxWidget } from './widgets/checkbox.ts';
import { BulletWidget } from './widgets/bullet.ts';
import { CopyButtonWidget } from './widgets/copy-button.ts';
import { TableWidget } from './widgets/table.ts';

// Tier 2: live-preview decoration builder. `buildDecorations` reads only
// `view.state` and `view.visibleRanges`, never the DOM, so a fake view drives
// it headlessly. The markdown language must be present (so `syntaxTree` has a
// tree) and the tree must be force-parsed — `EditorState.create` parses lazily
// and would otherwise yield an empty DecorationSet.

interface Deco {
  from: number;
  to: number;
  spec: {
    class?: string;
    attributes?: Record<string, string>;
    widget?: unknown;
  };
}

// Build decorations for `doc` with the cursor at `cursor` (default 0).
function decorate(doc: string, cursor = 0): Deco[] {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
  } as unknown as EditorView;
  const set = buildDecorations(view);
  const out: Deco[] = [];
  set.between(0, state.doc.length, (from, to, deco) => {
    out.push({ from, to, spec: deco.spec as Deco['spec'] });
  });
  return out;
}

// A decoration carrying the given class. By token, not by the whole string: a
// line decoration can hold several (`md-quote md-quote-rtl`), and the tests
// that assert a class is *absent* rely on this too.
function withClass(decos: Deco[], cls: string): Deco | undefined {
  return decos.find((d) => d.spec.class?.split(' ').includes(cls));
}

// The plain "hidden" markers are Decoration.replace({}): a replace deco whose
// spec has neither a widget nor a class. It must also cover a range — line
// decorations (the direction marker) are points, and would otherwise count as a
// hidden marker on every line.
function hiddenMarkers(decos: Deco[]): Deco[] {
  return decos.filter(
    (d) => d.from < d.to && d.spec.widget === undefined && d.spec.class === undefined,
  );
}

// The direction marker sitting on the line that starts at `from`.
function dirAt(decos: Deco[], from: number): string | undefined {
  return decos.find((d) => d.from === from && d.spec.attributes?.dir)?.spec.attributes?.dir;
}

test('parse is forced: a heading yields non-empty decorations', () => {
  assert.ok(decorate('# Title').length > 0, 'decorations should be non-empty');
});

test('headings get md-h1 / md-h2 / md-h3 line classes and hide HeaderMark', () => {
  assert.ok(withClass(decorate('# Title'), 'md-h1'), 'H1 line class');
  assert.ok(withClass(decorate('## Title'), 'md-h2'), 'H2 line class');
  assert.ok(withClass(decorate('### Title'), 'md-h3'), 'H3 line class');
  // The `# ` marker (positions 0..2) is hidden when the cursor is elsewhere.
  const decos = decorate('# Title\nbody', 9); // cursor on line 2
  assert.ok(
    hiddenMarkers(decos).some((d) => d.from === 0 && d.to === 2),
    'HeaderMark + trailing space hidden',
  );
});

test('bold gets md-strong and hides its emphasis markers', () => {
  // Bold on line 2, cursor parked on line 1 so the markers hide.
  const decos = decorate('top\na **x** b', 0);
  assert.ok(withClass(decos, 'md-strong'), 'md-strong mark');
  // Two `**` markers hidden.
  assert.equal(hiddenMarkers(decos).length, 2, 'both ** markers hidden');
});

test('italic gets md-emphasis, inline code gets md-inline-code', () => {
  assert.ok(withClass(decorate('top\na *x* b', 0), 'md-emphasis'), 'md-emphasis');
  assert.ok(withClass(decorate('top\na `x` b', 0), 'md-inline-code'), 'md-inline-code');
});

test('blockquote gets md-quote line class', () => {
  assert.ok(withClass(decorate('> q', 0), 'md-quote'), 'md-quote line class');
});

test('a list item whose content is a quote (`- > x`) gets no md-quote line class', () => {
  const decos = decorate('- > später\nbody', 12); // cursor off the list line
  assert.ok(!withClass(decos, 'md-quote'), 'no md-quote line class');
  assert.ok(
    decos.some((d) => d.spec.widget instanceof BulletWidget),
    'still renders as a list item (bullet widget present)',
  );
});

test('same fix applies to a nested/indented sub-list item (`    - > x`)', () => {
  const doc = '- top\n    - > später\nbody';
  const decos = decorate(doc, doc.length); // cursor off both list lines
  assert.ok(!withClass(decos, 'md-quote'), 'no md-quote line class on the sub-item');
  assert.ok(
    decos.filter((d) => d.spec.widget instanceof BulletWidget).length === 2,
    'both the top item and the sub-item still render as list items',
  );
});

test('unchecked task item produces an unchecked CheckboxWidget', () => {
  const decos = decorate('- [ ] x\nbody', 9); // cursor off the task line
  const box = decos.find((d) => d.spec.widget instanceof CheckboxWidget);
  assert.ok(box, 'CheckboxWidget present');
  assert.equal((box!.spec.widget as CheckboxWidget).checked, false, 'unchecked');
});

test('checked task item produces a checked CheckboxWidget', () => {
  const decos = decorate('- [x] x\nbody', 9);
  const box = decos.find((d) => d.spec.widget instanceof CheckboxWidget);
  assert.ok(box, 'CheckboxWidget present');
  assert.equal((box!.spec.widget as CheckboxWidget).checked, true, 'checked');
});

test('plain bullet produces a BulletWidget', () => {
  const decos = decorate('- x\nbody', 6); // cursor off the bullet line
  assert.ok(
    decos.some((d) => d.spec.widget instanceof BulletWidget),
    'BulletWidget present',
  );
});

test('link gets md-link with a data-href equal to the URL', () => {
  const decos = decorate('[text](http://u)\nbody', 18); // cursor off the link line
  const link = withClass(decos, 'md-link');
  assert.ok(link, 'md-link mark');
  assert.equal(link!.spec.attributes?.['data-href'], 'http://u', 'data-href');
});

test('bare autolink is a visible md-link (not hidden) with a data-href', () => {
  const off = decorate('visit https://example.com now\nbody', 33); // cursor on line 2
  const link = withClass(off, 'md-link');
  assert.ok(link, 'md-link mark on the bare URL');
  assert.equal(link!.spec.attributes?.['data-href'], 'https://example.com');
  // The URL range must not be blanket-hidden.
  assert.ok(
    !hiddenMarkers(off).some((d) => d.from === link!.from && d.to === link!.to),
    'URL not hidden',
  );
});

test('<url> autolink: URL styled as md-link, its <> LinkMarks hidden', () => {
  const off = decorate('<https://example.com>\nbody', 23);
  const link = withClass(off, 'md-link');
  assert.ok(link, 'md-link on the autolink URL');
  assert.equal(link!.spec.attributes?.['data-href'], 'https://example.com');
  // The `<` and `>` LinkMarks are still hidden.
  assert.equal(hiddenMarkers(off).length, 2, 'both <> markers hidden');
});

test('bare www link gets an https:// scheme in its data-href', () => {
  const off = decorate('www.example.com\nbody', 17);
  const link = withClass(off, 'md-link');
  assert.ok(link, 'md-link on the www URL');
  assert.equal(link!.spec.attributes?.['data-href'], 'https://www.example.com');
});

test('image URL stays hidden (not turned into a link)', () => {
  const off = decorate('![alt](http://img.png)\nbody', 24);
  assert.ok(!withClass(off, 'md-link'), 'no md-link for an image destination');
  // The destination URL is still hidden as a redundant marker.
  assert.ok(hiddenMarkers(off).length > 0, 'image URL hidden');
});

test('reveal on cursor: heading marker NOT hidden when cursor is on the line', () => {
  const off = decorate('# Title\nbody', 9); // cursor on line 2
  const on = decorate('# Title\nbody', 3); // cursor inside the heading line
  assert.ok(
    hiddenMarkers(off).some((d) => d.from === 0 && d.to === 2),
    'marker hidden when cursor elsewhere',
  );
  assert.ok(
    !hiddenMarkers(on).some((d) => d.from === 0),
    'marker revealed when cursor on the line',
  );
  // The line class itself stays in both cases.
  assert.ok(withClass(on, 'md-h1'), 'h1 class persists while editing');
});

test('reveal on cursor: no CheckboxWidget when cursor is on the task line', () => {
  const off = decorate('- [ ] x\nbody', 9);
  const on = decorate('- [ ] x\nbody', 3); // cursor on the task line
  assert.ok(
    off.some((d) => d.spec.widget instanceof CheckboxWidget),
    'widget present when cursor elsewhere',
  );
  assert.ok(
    !on.some((d) => d.spec.widget instanceof CheckboxWidget),
    'no widget while editing the task line',
  );
});

test('reveal on cursor: link is plain (no data-href) when cursor is on the line', () => {
  const on = decorate('[text](http://u)\nbody', 3); // cursor on the link line
  const link = withClass(on, 'md-link');
  assert.ok(link, 'md-link still classed while editing');
  assert.equal(link!.spec.attributes, undefined, 'no data-href while editing');
});

// --- Thematic break (`---`) --------------------------------------------
// A separator renders as an `md-hr` line class with the raw markers hidden.
// The false-positive cases matter as much as the positive ones: `---` under
// text is a setext heading, and 1-2 markers / trailing text are not breaks.

function hasRule(decos: Deco[]): boolean {
  return withClass(decos, 'md-hr') !== undefined;
}

test('three minuses render a separator and hide the raw markers', () => {
  const decos = decorate('---\nbody', 5); // cursor on line 2
  assert.ok(hasRule(decos), 'md-hr line class');
  assert.ok(
    hiddenMarkers(decos).some((d) => d.from === 0 && d.to === 3),
    'the `---` text is hidden',
  );
});

test('more than three minuses still render exactly one separator', () => {
  const decos = decorate('----------\nbody', 12);
  assert.equal(
    decos.filter((d) => d.spec.class === 'md-hr').length,
    1,
    'one md-hr line class',
  );
  assert.ok(
    hiddenMarkers(decos).some((d) => d.from === 0 && d.to === 10),
    'all ten minuses hidden',
  );
});

test('spaced (`- - -`) and indented (`   ---`) breaks render a separator', () => {
  assert.ok(hasRule(decorate('- - -\nbody', 7)), 'spaced markers');
  assert.ok(hasRule(decorate('   ---\nbody', 8)), 'up to 3 leading spaces');
});

test('false positive: `***` / `___` breaks are minus-only, so no separator', () => {
  // CommonMark calls these thematic breaks too, but this editor deliberately
  // only draws a rule for minuses.
  assert.ok(!hasRule(decorate('***\nbody', 5)), 'asterisk break stays text');
  assert.ok(!hasRule(decorate('___\nbody', 5)), 'underscore break stays text');
  assert.ok(!hasRule(decorate('*** \n* * *\nbody', 11)), 'spaced asterisks too');
});

test('false positive: fewer than three minuses is not a separator', () => {
  assert.ok(!hasRule(decorate('--\nbody', 4)), '`--` is not a break');
  assert.ok(!hasRule(decorate('-\nbody', 3)), 'a lone `-` is a list bullet');
});

test('false positive: `---` under text is a setext heading, not a separator', () => {
  assert.ok(!hasRule(decorate('Title\n---\nbody', 11)), 'setext H2, not a rule');
});

test('false positive: minuses mid-line or with trailing text are not separators', () => {
  assert.ok(!hasRule(decorate('a --- b\nbody', 9)), 'inline minuses');
  assert.ok(!hasRule(decorate('--- text\nbody', 10)), 'trailing text');
  assert.ok(!hasRule(decorate('- item\nbody', 8)), 'list item');
});

test('false positive: `---` inside a fenced code block is not a separator', () => {
  assert.ok(!hasRule(decorate('```\n---\n```\nbody', 13)), 'fenced code content');
});

test('reveal on cursor: raw `---` stays visible when the cursor is on the line', () => {
  const on = decorate('---\nbody', 1); // cursor inside the rule line
  assert.ok(hasRule(on), 'md-hr class persists while editing');
  assert.ok(
    !hiddenMarkers(on).some((d) => d.from === 0 && d.to === 3),
    'markers revealed when the cursor is on the line',
  );
});

test('fenced code block gets a copy button carrying the body without fences', () => {
  const decos = decorate('```js\nconst a = 1;\nfoo();\n```\n');
  const button = decos.find((d) => d.spec.widget instanceof CopyButtonWidget);
  assert.ok(button, 'expected a copy-button widget');
  // No trailing newline (CodeText stops before it) — pasting a shell command
  // into a terminal should not auto-run it.
  assert.equal(
    (button.spec.widget as CopyButtonWidget).code,
    'const a = 1;\nfoo();',
  );
  // Pinned to the end of the opening fence line, so it renders top-right.
  assert.equal(button.from, '```js'.length);
});

test('an empty code block gets no copy button', () => {
  const decos = decorate('```\n```\n');
  assert.equal(decos.some((d) => d.spec.widget instanceof CopyButtonWidget), false);
});

test('only the outer lines of a code block are tagged for rounding', () => {
  // ```js / body / ``` — three lines, so the middle one must stay square or the
  // per-line backgrounds would show a notch mid-block.
  const classes = decorate('```js\nfoo();\n```\nafter')
    .filter((d) => d.spec.class?.includes('md-code-block'))
    .map((d) => d.spec.class);
  assert.deepEqual(classes, [
    'md-code-block md-code-first',
    'md-code-block',
    'md-code-block md-code-last',
  ]);
});

test('a one-line code block is both the first and the last line', () => {
  // An unterminated fence is a FencedCode covering a single line; it still has
  // to round all four corners.
  const classes = decorate('```js')
    .filter((d) => d.spec.class?.includes('md-code-block'))
    .map((d) => d.spec.class);
  assert.deepEqual(classes, ['md-code-block md-code-first md-code-last']);
});

test('a fence inside a blockquote copies its whole body', () => {
  // In a quote the body is one CodeText per line (QuoteMarks interrupt it), so
  // reading a single child would silently copy only the first line.
  const decos = decorate('> ```js\n> const a = 1;\n> foo();\n> ```\n');
  const button = decos.find((d) => d.spec.widget instanceof CopyButtonWidget);
  assert.ok(button, 'expected a copy-button widget');
  assert.equal(
    (button.spec.widget as CopyButtonWidget).code,
    'const a = 1;\nfoo();',
  );
});

test('a fence inside a list item copies its whole body', () => {
  const decos = decorate('- item\n  ```js\n  const a = 1;\n  foo();\n  ```\n');
  const button = decos.find((d) => d.spec.widget instanceof CopyButtonWidget);
  assert.ok(button, 'expected a copy-button widget');
  assert.equal(
    (button.spec.widget as CopyButtonWidget).code,
    'const a = 1;\nfoo();',
  );
});

test('a code block spanning two visible ranges gets one copy button', () => {
  // CodeMirror splits the viewport around very long lines; the block is then
  // entered once per range, and two widgets would stack at the same position.
  const doc = '```js\nconst a = 1;\nfoo();\n```\n';
  const state = EditorState.create({
    doc,
    selection: { anchor: 0 },
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const view = {
    state,
    visibleRanges: [{ from: 0, to: 10 }, { from: 12, to: doc.length }],
  } as unknown as EditorView;
  let count = 0;
  const iter = buildDecorations(view).iter();
  while (iter.value) {
    if (iter.value.spec.widget instanceof CopyButtonWidget) count++;
    iter.next();
  }
  assert.equal(count, 1, 'exactly one copy button');
});

test('each line is directed by its own first strong character', () => {
  const doc = 'Hello world\nمرحبا بالعالم\n- عنصر\n\n12345\n\n> اقتباس';
  const decos = decorate(doc);
  const state = EditorState.create({ doc });
  const dirs = [1, 2, 3, 5, 7].map((n) => dirAt(decos, state.doc.line(n).from));
  // The digits-only line stands alone here: neutral, inside no block that could
  // decide for it, so it keeps the editor's own direction and gets no marker at
  // all rather than a guessed one.
  assert.deepEqual(dirs, ['ltr', 'rtl', 'rtl', undefined, 'rtl']);
});

test('a fresh list item takes the list direction before it has any text', () => {
  // Pressing Enter in an Arabic list inserts `- ` / `2. ` / `- [ ] `, which
  // carries no letters. Left to the page it would sit at the left edge under a
  // right-aligned list and jump across on the first keystroke.
  for (const marker of ['- ', '2. ', '- [ ] ']) {
    const doc = `- عنصر\n${marker}`;
    const state = EditorState.create({ doc });
    assert.equal(
      dirAt(decorate(doc), state.doc.line(2).from), 'rtl',
      `a fresh \`${marker}\` item`,
    );
  }
  // And a Latin list is unaffected.
  assert.equal(dirAt(decorate('- item\n- '), 8), undefined, 'no marker forced on an LTR list');
});


test('code lines are pinned left-to-right, whatever the code says', () => {
  // `//` is neutral, so the first strong character is Arabic. Left to itself the
  // line would turn around inside an otherwise LTR block.
  const doc = '```js\n// مرحبا\n```';
  const state = EditorState.create({ doc });
  const decos = decorate(doc);
  for (let n = 1; n <= 3; n++) {
    assert.equal(dirAt(decos, state.doc.line(n).from), 'ltr', `code line ${n} stays LTR`);
  }
});

test('revealing the markers on the active line does not turn the line around', () => {
  // The URL is hidden while the cursor is elsewhere and shown once it lands on
  // the line. Judged by *rendered* text this line would read RTL and then LTR,
  // flipping sides — and taking the caret with it — on a click. Judged by the
  // document it is LTR either way: the `h` of `https` is the first strong
  // character and stays one whether or not it is on screen. Consistency is the
  // point here, not which of the two directions wins.
  const doc = '![](https://example.com) مرحبا';
  const off = dirAt(decorate(doc + '\nx', doc.length + 2), 0); // cursor on line 2
  const on = dirAt(decorate(doc + '\nx', 2), 0); // cursor inside the line
  assert.equal(off, on, 'same direction whether the markers are hidden or shown');
  // Which of the two wins is deliberately not pinned: today the URL decides, and
  // teaching lineDirection to skip link destinations would be a defensible
  // change. Flipping sides on a click would not be.
});



test('lineDirection leaves a line with no deciding character undecided', () => {
  assert.equal(lineDirection(''), null, 'blank');
  assert.equal(lineDirection('  ---  '), null, 'punctuation only');
  assert.equal(lineDirection('12345'), null, 'digits are neutral');
  assert.equal(lineDirection('٢٠٢٤ report'), 'ltr', 'Arabic-Indic digits too: \\p{Script=Arabic} alone would say rtl');
  assert.equal(lineDirection('123 مرحبا'), 'rtl', 'digits do not preempt the letter');
  assert.equal(lineDirection('**עברית**'), 'rtl', 'markup does not preempt it either');
});


test('an explicit direction mark wins, which is how you override the guess', () => {
  // RLM / LRM are the standard way to state a line's direction when its first
  // letter would get it wrong — a brand name opening an Arabic sentence.
  assert.equal(lineDirection('\u200fGitHub مرحبا'), 'rtl', 'RLM forces right-to-left');
  assert.equal(lineDirection('\u200eمرحبا'), 'ltr', 'LRM forces left-to-right');
  assert.equal(lineDirection('\u061cمرحبا'), 'rtl', 'ALM, the Arabic-script variant');
});


test('ticking a task does not turn the item around', () => {
  // The `x` in `- [x]` is a letter. Taken as content it decides the line before
  // the Arabic does, so a tap on the checkbox would flip the item to the other
  // side of the page — and untapping it would flip it back.
  assert.equal(dirAt(decorate('- [ ] مرحبا'), 0), 'rtl', 'unticked');
  assert.equal(dirAt(decorate('- [x] مرحبا'), 0), 'rtl', 'ticked');
  assert.equal(dirAt(decorate('- [X] مرحبا'), 0), 'rtl', 'ticked, capital');
  assert.equal(dirAt(decorate('1. مرحبا'), 0), 'rtl', 'ordered list marker');
  assert.equal(dirAt(decorate('- [x] hello'), 0), 'ltr', 'and Latin text still reads LTR');
});

test('a line inside a quote that decides nothing takes the quote direction', () => {
  // A bare `>` is how you separate two paragraphs inside one quote. With no
  // direction of its own it would fall through to the page and swing the quote
  // bar to the other side for that one line.
  const doc = '> مرحبا\n>\n> 2024\n> وداعا';
  const state = EditorState.create({ doc });
  const decos = decorate(doc);
  const dirs = [1, 2, 3, 4].map((n) => dirAt(decos, state.doc.line(n).from));
  assert.deepEqual(dirs, ['rtl', 'rtl', 'rtl', 'rtl']);
});


test('a table reads in one direction, so its columns stay under their headers', () => {
  // Per line, the mixed row would reverse its pipes and slide its cells one
  // column over. Nothing styles tables here — the alignment is the pipes.
  const doc = '| term | ترجمة |\n|---|---|\n| book | كتاب |\n| كتاب | book |';
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const decos = decorate(doc);
  const dirs = [1, 2, 3, 4].map((n) => dirAt(decos, state.doc.line(n).from));
  assert.deepEqual(dirs, ['ltr', 'ltr', 'ltr', 'ltr'], 'the header decides for all of them');
});

test('an Arabic table reads right-to-left throughout', () => {
  const doc = '| مصطلح | ترجمة |\n|---|---|\n| كتاب | book |';
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const decos = decorate(doc);
  assert.deepEqual(
    [1, 2, 3].map((n) => dirAt(decos, state.doc.line(n).from)),
    ['rtl', 'rtl', 'rtl'],
  );
});

test('indented code is pinned on every line, not just its first', () => {
  const doc = 'text\n\n    // مرحبا\n    const a = 1;\n    return a;\n';
  const state = EditorState.create({ doc });
  const decos = decorate(doc);
  assert.deepEqual(
    [3, 4, 5].map((n) => dirAt(decos, state.doc.line(n).from)),
    ['ltr', 'ltr', 'ltr'],
  );
});


test('every right-to-left script in the list is recognised', () => {
  // A static list, so near-zero upkeep — and the one thing that stops a script
  // being dropped from the regex unnoticed, which is how Hanifi Rohingya was
  // missing for this feature's whole life until someone checked by hand.
  for (const sample of ['مرحبا', 'שלום', '𞤀𞤣', '𐴀𐴌', 'ࡀࡁ', 'ߒߞߏ', 'ࠀࠁ', 'ܐܒ', 'ދިވެހި']) {
    assert.equal(lineDirection(sample), 'rtl', sample);
  }
});

test('a block decides only for lines that decide nothing themselves', () => {
  // An English line inside an Arabic quote keeps its own direction — the quote
  // is a fallback, not an override. Same for a list.
  const quote = '> مرحبا\n> Hello world';
  const qState = EditorState.create({ doc: quote });
  assert.equal(dirAt(decorate(quote), qState.doc.line(2).from), 'ltr', 'line in a quote');

  const list = '- عنصر\n- Hello world';
  const lState = EditorState.create({ doc: list });
  assert.equal(dirAt(decorate(list), lState.doc.line(2).from), 'ltr', 'item in a list');
});

test('a block whose first line decides nothing is read further down', () => {
  // The quote opens with a bare `>`; its direction is on the line below. Taking
  // only the first line would leave the whole quote undirected.
  const doc = '>\n> مرحبا';
  const state = EditorState.create({ doc });
  const decos = decorate(doc);
  assert.deepEqual(
    [1, 2].map((n) => dirAt(decos, state.doc.line(n).from)),
    ['rtl', 'rtl'],
  );
});

test('the quote bar keeps one side for the whole quote', () => {
  // A quote can hold lines of both directions — an English sentence among
  // Arabic ones, a code block that is always left-to-right. Placed by each
  // line's own direction, the bar would cross to the other side mid-quote.
  const doc = '> مرحبا يا صديقي\n> This line is English.\n> ```\n> const a = 1;\n> ```';
  const state = EditorState.create({ doc });
  const decos = decorate(doc);
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const classes = decos
      .filter((d) => d.from === line.from && d.spec.class)
      .flatMap((d) => d.spec.class!.split(' '));
    assert.ok(classes.includes('md-quote-rtl'), `line ${n} takes the quote's side`);
  }
  // And each line still reads in its own direction.
  assert.equal(dirAt(decos, state.doc.line(1).from), 'rtl', 'the Arabic line');
  assert.equal(dirAt(decos, state.doc.line(2).from), 'ltr', 'the English line');
  assert.equal(dirAt(decos, state.doc.line(4).from), 'ltr', 'the code line');
});

test('an English quote keeps its bar on the left', () => {
  assert.ok(withClass(decorate('> quoted\n> مرحبا', 0), 'md-quote-ltr'), 'ltr quote');
  assert.ok(!withClass(decorate('> quoted\n> مرحبا', 0), 'md-quote-rtl'), 'and not the other side');
});

// The rendered table, if one replaced the block. Tables come from a state
// field rather than the view plugin — CodeMirror only takes block decorations
// from a field — so they are built from the state alone, with no fake view.
function tableWidget(doc: string, cursor = 0): TableWidget | undefined {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  let found: TableWidget | undefined;
  buildTables(state).between(0, state.doc.length, (_f, _t, deco) => {
    const widget = (deco.spec as { widget?: unknown }).widget;
    if (widget instanceof TableWidget) found = widget;
  });
  return found;
}

const TABLE = '| term | ترجمة |\n|:---|---:|\n| **book** | كتاب |';

test('a table renders while the cursor is elsewhere', () => {
  const widget = tableWidget(`text\n\n${TABLE}`);
  assert.ok(widget, 'the block is replaced');
  assert.deepEqual(widget!.spec.align, ['start', 'end'], 'alignment from the delimiter row');
  // TableCell excludes the padding around it, so the cells arrive trimmed.
  assert.equal(widget!.spec.header.map((c) => c.map((s) => s.text).join('')).join('|'), 'term|ترجمة');
});

test('a table shows its source as soon as the selection touches it', () => {
  // Same rule the inline markers follow, over a range instead of a line.
  assert.equal(tableWidget(TABLE, 2), undefined, 'cursor in the header');
  assert.equal(tableWidget(TABLE, TABLE.length), undefined, 'cursor in the last row');
  assert.ok(tableWidget(`${TABLE}\n\nafter`, TABLE.length + 3), 'cursor below it');
});

test('cell contents keep the classes the rest of the preview paints with', () => {
  const widget = tableWidget(`text\n\n${TABLE}`)!;
  const cell = widget.spec.rows[0][0];
  assert.deepEqual(cell, [{ text: 'book', cls: 'md-strong' }], 'the ** markers are gone, the class is not');
});

test('a link in a cell becomes a link, not its source', () => {
  const doc = 'x\n\n| a |\n|---|\n| [docs](example.com) |';
  const widget = tableWidget(doc)!;
  assert.deepEqual(widget.spec.rows[0][0], [
    { text: 'docs', cls: 'md-link', href: 'https://example.com' },
  ]);
});

test('a table takes its own direction', () => {
  const rtl = 'x\n\n| مصطلح | ترجمة |\n|---|---|\n| كتاب | book |';
  assert.equal(tableWidget(rtl)!.spec.dir, 'rtl');
  assert.equal(tableWidget(`x\n\n${TABLE}`)!.spec.dir, 'ltr');
});

test('a quote takes its side from prose, not from the code above it', () => {
  // `blockDirection` reads raw lines, and code is pinned left-to-right whatever
  // it contains — so a quote opening with a fenced block would take its bar
  // side from `const x = 1` and draw it on the far side of the Arabic below.
  const doc = '> ```js\n> const x = 1;\n> ```\n> مرحبا';
  assert.ok(withClass(decorate(doc), 'md-quote-rtl'), 'the prose decides');
  assert.ok(!withClass(decorate(doc), 'md-quote-ltr'), 'not the code');
});

test('a quote with no letters at all still gets a side', () => {
  assert.ok(withClass(decorate('> 123\n> 456'), 'md-quote-ltr'), 'falls back to the page');
});

test('a quote decides on a later line when its first says nothing', () => {
  assert.ok(withClass(decorate('>\n> مرحبا'), 'md-quote-rtl'));
});

test('an empty cell stays a cell instead of sliding the next one over', () => {
  // The parser emits a TableCell only where there is content, so reading the
  // nodes alone would put `3` under the second column — silently, in a view
  // that hides the source.
  const widget = tableWidget('x\n\n| a | b | c |\n|---|---|---|\n| 1 |   | 3 |')!;
  assert.deepEqual(
    widget.spec.rows[0].map((cell) => cell.map((s) => s.text).join('')),
    ['1', '', '3'],
  );
});

test('a row is sized by the header, short or long', () => {
  // GFM pads a short row and cuts a long one; otherwise a ragged row grows a
  // column of its own and the table loses its shape.
  const widget = tableWidget('x\n\n| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |')!;
  assert.deepEqual(widget.spec.rows.map((r) => r.length), [2, 2]);
});

test('a table in a blockquote has no phantom rows', () => {
  // Inside a quote the parser hangs a QuoteMark on the table for every line,
  // and those are not rows.
  const widget = tableWidget('x\n\n> | a | b |\n> |---|---|\n> | 1 | 2 |')!;
  assert.deepEqual(widget.spec.rows.map((r) => r.map((c) => c.map((s) => s.text).join(''))), [['1', '2']]);
});

test('an escaped pipe shows the pipe, not the backslash', () => {
  // `\\|` is the only way to put a pipe in a cell.
  const widget = tableWidget('x\n\n| a |\n|---|\n| p \\| q |')!;
  assert.equal(widget.spec.rows[0][0].map((s) => s.text).join(''), 'p | q');
});

// --- Link destinations ------------------------------------------------------
// The document is shared over chat, so a link's destination is peer-supplied
// and ends up in `window.open()` (see linkClickHandler). Only http(s)/mailto
// may become a clickable data-href.

function dataHref(doc: string, cursor: number): string | undefined {
  return withClass(decorate(doc, cursor), 'md-link')?.spec.attributes?.['data-href'];
}

test('a javascript: destination never becomes a clickable data-href', () => {
  const decos = decorate('[click me](javascript:alert(1))\nbody', 33);
  const link = withClass(decos, 'md-link');
  assert.ok(link, 'still styled as a link');
  assert.equal(link!.spec.attributes, undefined, 'but not openable');
});

test('a data: destination never becomes a clickable data-href', () => {
  assert.equal(dataHref('[x](data:text/html,<script>1</script>)\nbody', 42), undefined);
});

test('a relative / fragment destination is not opened', () => {
  assert.equal(dataHref('[x](/foo.md)\nbody', 14), undefined);
  assert.equal(dataHref('[x](#section)\nbody', 15), undefined);
});

test('http(s) destinations still pass through untouched', () => {
  assert.equal(dataHref('[x](https://a.example/p?q=1#f)\nbody', 31), 'https://a.example/p?q=1#f');
  assert.equal(dataHref('[x](http://a.example)\nbody', 23), 'http://a.example');
});

test('a mailto: autolink keeps its own scheme', () => {
  // `https://mailto:a@b.com` was the old output — withScheme only recognised
  // schemes written with `://`.
  assert.equal(dataHref('<mailto:a@b.com>\nbody', 18), 'mailto:a@b.com');
  assert.equal(dataHref('[mail me](mailto:a@b.com)\nbody', 27), 'mailto:a@b.com');
});

test('a bare email autolink is opened as mailto:, not https://', () => {
  assert.equal(dataHref('write to a@b.com now\nbody', 22), 'mailto:a@b.com');
});

// --- Other markup -----------------------------------------------------------

test('a link inside a table cell is held to the same scheme allow-list', () => {
  // The table path is a separate call site, and a riskier one: the cell builds
  // a real <a href> as well as calling window.open(), so a `javascript:` URL
  // would be live on plain keyboard activation, not just the click handler.
  const cellHref = (dest: string): string | undefined =>
    tableWidget(`x\n\n| a |\n|---|\n| [t](${dest}) |`)!.spec.rows[0][0]
      .find((seg) => seg.cls === 'md-link')?.href;

  assert.equal(cellHref('https://example.com'), 'https://example.com');
  assert.equal(cellHref('mailto:a@b.com'), 'mailto:a@b.com');
  assert.equal(cellHref('javascript:alert(1)'), undefined, 'javascript: is not openable');
  assert.equal(cellHref('/relative'), undefined, 'a relative path is not openable');
});

test('an ordered list keeps its number (no bullet widget swallows it)', () => {
  const decos = decorate('1. one\nbody', 8);
  assert.ok(
    !decos.some((d) => d.spec.widget instanceof BulletWidget),
    'ListMark `1.` is left alone',
  );
});

test('strikethrough gets md-strike', () => {
  assert.ok(withClass(decorate('top\n~~x~~', 0), 'md-strike'), 'md-strike mark');
});

test('a selection spanning several lines reveals the markup on all of them', () => {
  // lineHasSelection tests each line against every range, so a drag across two
  // headings must un-hide both — hiding markup mid-selection shifts the text
  // out from under the pointer.
  const state = EditorState.create({
    doc: '# a\n# b',
    selection: { anchor: 0, head: 7 },
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
  } as unknown as EditorView;
  const out: Deco[] = [];
  buildDecorations(view).between(0, state.doc.length, (from, to, deco) => {
    out.push({ from, to, spec: deco.spec as Deco['spec'] });
  });
  assert.equal(hiddenMarkers(out).length, 0, 'nothing hidden under the selection');
});

test('an empty document produces no decorations and does not throw', () => {
  assert.deepEqual(decorate(''), []);
});
