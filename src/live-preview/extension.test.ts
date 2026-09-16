import { test, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();
const { EditorState } = await import('@codemirror/state');
const { EditorView } = await import('@codemirror/view');
const { livePreview } = await import('./index.ts');
const { markdown, markdownLanguage } = await import('@codemirror/lang-markdown');
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
