import { test, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

// A file of its own: KaTeX loads once per process, and this is about the table
// that is built before it has.
GlobalRegistrator.register();
Object.defineProperty(document, 'compatMode', { value: 'CSS1Compat' });
const { TableWidget } = await import('./table.ts');
after(() => GlobalRegistrator.unregister());

test('a math cell shows its TeX until KaTeX loads, then typesets and re-measures', async () => {
  let measured = 0;
  let anchor: number | undefined;
  const view = {
    requestMeasure: () => { measured++; },
    dispatch: (tr: { selection: { anchor: number } }) => { anchor = tr.selection.anchor; },
  } as unknown as import('@codemirror/view').EditorView;
  const widget = new TableWidget({
    from: 7,
    header: [[{ text: '$x^2$', math: { tex: 'x^2', display: false } }]],
    rows: [[[{ text: '$$y$$', math: { tex: 'y', display: true } }]]],
    align: [null],
    dir: null,
    source: '| $x^2$ |\n|---|\n| $$y$$ |',
  });
  const dom = document.body.appendChild(widget.toDOM(view));
  const [inline, display] = [dom.querySelector('th .md-math-inline')!, dom.querySelector('td .md-math')!];
  assert.equal(inline.textContent, 'x^2', 'the TeX, while KaTeX loads');
  assert.equal(display.textContent, 'y');
  for (let tick = 0; tick < 100 && !display.querySelector('.katex'); tick++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.ok(inline.querySelector('.katex') && display.querySelector('.katex-display'), 'typeset once loaded');
  assert.ok(measured > 0, 'and the table, now another size, is measured again');

  // A tap on a formula opens the table's source, as a tap elsewhere in it does.
  inline.querySelector('.katex')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  assert.equal(anchor, 7);
  dom.remove();
});
