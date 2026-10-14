import { test, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();
// KaTeX refuses to render outside standards mode, and happy-dom has no
// `compatMode` at all. The app is in standards mode: index.html has a doctype.
Object.defineProperty(document, 'compatMode', { value: 'CSS1Compat' });
const { EditorView } = await import('@codemirror/view');
const { syntaxTree } = await import('@codemirror/language');
const { createEditor, setReadMode } = await import('../editor.ts');
const { toggleBold, cycleHeading, toggleBullet } = await import('../commands.ts');
after(() => GlobalRegistrator.unregister());

// Math while it is being edited, in a real EditorView with the app's own
// extensions: what is typeset as the caret moves and the text changes, where a
// tap on a formula puts the caret, and which way a line with math reads.

type View = InstanceType<typeof EditorView>;

function withEditor(doc: string, fn: (view: View) => void): void {
  const view = createEditor(document.body, doc);
  try {
    fn(view);
  } finally {
    view.destroy();
  }
}

const inlineMath = (view: View): HTMLElement[] =>
  [...view.contentDOM.querySelectorAll<HTMLElement>('.md-math-inline')];
const tap = (el: Element): void => {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
};
// Type `text` one character at a time at the caret, as a keyboard would.
function type(view: View, text: string, each: (typed: string) => void = () => {}): void {
  for (const ch of text) {
    const at = view.state.selection.main.head;
    view.dispatch({ changes: { from: at, insert: ch }, selection: { anchor: at + 1 }, userEvent: 'input.type' });
    each(ch);
  }
}

test('typing `$x^2$` hides nothing that is being typed, and the caret stays put', () => {
  withEditor('Area: \n\nafter', (view) => {
    view.dispatch({ selection: { anchor: 6 } });
    type(view, '$x^2$', () => {
      assert.deepEqual(inlineMath(view), [], `nothing typeset under the caret: ${view.state.doc.line(1).text}`);
      assert.equal(view.state.selection.main.head, view.state.doc.line(1).to, 'the caret is where the typing is');
    });
    type(view, ' m');
    assert.equal(inlineMath(view).length, 1, 'typed past it, the formula typesets');
    const line = view.contentDOM.querySelector('.cm-line')!;
    assert.ok(line.textContent!.startsWith('Area: ') && line.textContent!.endsWith(' m'), 'the prose around it stays');
  });
});

test('typing on after a mid-paragraph `$$` close keeps the formula closed', () => {
  // `We get $$`, Enter, TeX, Enter, `$$` closes it (as in Obsidian). Going on
  // to type ` and more` — or just a full stop — on that closing line must not
  // reopen it: today the line becomes an unclosed `$$` block that eats the
  // lines below up to the next blank one and styles them as code.
  withEditor('We get $$\na^2\n$$\nmore prose\n\nafter', (view) => {
    view.dispatch({ selection: { anchor: view.state.doc.line(3).to } });
    type(view, '. And', () => {
      const names: string[] = [];
      syntaxTree(view.state).iterate({ enter: (n) => { names.push(n.name); } });
      assert.ok(!names.includes('MathBlock'), `${JSON.stringify(view.state.doc.line(3).text)}: no block opened`);
      assert.ok(names.includes('DisplayMath'), 'the formula is still closed');
    });
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    assert.equal(view.contentDOM.querySelectorAll('.md-math').length, 1, 'and it typesets once the caret leaves');
    assert.equal(view.contentDOM.querySelector('.md-code-block'), null, 'nothing below it is styled as code');
  });
});

test('a tap on an inline formula puts the caret at it, whatever the line is', () => {
  // posAtDOM on the span, so a heading's `# `, a bullet or a quote's `> `
  // before it, and an equal formula elsewhere on the line, do not matter.
  const cases: [string, number, number][] = [
    ['# Title $x$ more', 0, 8],
    ['- item $x$', 0, 7],
    ['> quote $x$', 0, 8],
    ['a $x$ b $x$ c', 1, 8],
  ];
  for (const [line, nth, at] of cases) {
    withEditor(`${line}\n\nend`, (view) => {
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      tap(inlineMath(view)[nth]);
      assert.equal(view.state.selection.main.head, at, JSON.stringify(line));
      assert.equal(inlineMath(view).length, nth, 'and that formula shows its source');
    });
  }
});

test('an equal formula keeps its element when text moves it, and a tap finds where it is now', () => {
  withEditor('a $x$ b\n\nend', (view) => {
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    const before = inlineMath(view)[0];
    view.dispatch({ changes: { from: 0, insert: 'moved ' } });
    assert.equal(inlineMath(view)[0], before, 'not re-typeset');
    tap(before);
    assert.equal(view.state.selection.main.head, 8);
  });
});

test('toolbar formatting on a line with math leaves its `$` alone', () => {
  withEditor('a $x$ b\n\nend', (view) => {
    view.dispatch({ selection: { anchor: 0, head: 7 } });
    toggleBold(view);
    view.dispatch({ selection: { anchor: 4 } });
    cycleHeading(view);
    toggleBullet(view);
    assert.equal(view.state.doc.line(1).text, '- # **a $x$ b**');
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    assert.equal(inlineMath(view).length, 1, 'still typeset');
  });
});

test('a line that opens with inline math reads in the direction of its prose', () => {
  // TeX is not prose: its `x` or `\alpha` is no reason to lay an Arabic
  // sentence out left to right (the widget pins the formula itself LTR).
  withEditor('$x$ مرحبا بالعالم\n- $y$ عنصر\n\n$\\alpha$ שלום\n\n$x$ hello\n\nمرحبا $z$', (view) => {
    const dirs = [...view.contentDOM.querySelectorAll('.cm-line')]
      .map((l) => [l.textContent, l.getAttribute('dir')])
      .filter(([text]) => text);
    assert.deepEqual(dirs.map(([, dir]) => dir), ['rtl', 'rtl', 'rtl', 'ltr', 'rtl'], JSON.stringify(dirs));
    for (const math of inlineMath(view)) assert.equal(math.getAttribute('dir'), 'ltr');
  });
});

test('in read mode, a tap on a formula is a reader’s tap', () => {
  withEditor('[see $x$](https://a.example) and $y$\n\nend', (view) => {
    setReadMode(view, true);
    const opened: string[] = [];
    const open = window.open;
    window.open = ((url: string) => { opened.push(url); return null; }) as typeof window.open;
    try {
      const [inLink, plain] = inlineMath(view);
      tap(plain);
      assert.equal(view.state.selection.main.head, 0, 'no caret moves in read mode');
      // Math in a link's text is part of the link: today the link mark is
      // split around the widget, and the widget swallows the tap.
      assert.ok(inLink.closest('.md-link[data-href]'), 'the formula is inside the link');
      tap(inLink);
      assert.deepEqual(opened, ['https://a.example'], 'and tapping it follows the link');
    } finally {
      window.open = open;
    }
  });
});
