import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { buildDecorations } from './decorations.ts';
import { CheckboxWidget } from './widgets/checkbox.ts';
import { BulletWidget } from './widgets/bullet.ts';

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

// A decoration with the given class.
function withClass(decos: Deco[], cls: string): Deco | undefined {
  return decos.find((d) => d.spec.class === cls);
}

// The plain "hidden" markers are Decoration.replace({}): a replace deco whose
// spec has neither a widget nor a class.
function hiddenMarkers(decos: Deco[]): Deco[] {
  return decos.filter((d) => d.spec.widget === undefined && d.spec.class === undefined);
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
