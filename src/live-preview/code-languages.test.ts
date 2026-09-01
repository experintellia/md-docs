import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { EditorState } from '@codemirror/state';
import { LanguageDescription, ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import { codeLanguages } from './code-languages.ts';

// Tier 2: fenced-code highlighting. `@codemirror/lang-markdown` mounts the
// nested language as a parse *overlay*, which a plain tree walk does not
// descend into — `highlightTree` does, and it is what actually paints the
// editor, so assert on the token classes it emits.

// Token class -> highlighted text, for everything inside `doc`.
function tokens(doc: string): Map<string, string[]> {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, codeLanguages })],
  });
  const out = new Map<string, string[]>();
  highlightTree(
    ensureSyntaxTree(state, doc.length, 5000)!,
    classHighlighter,
    (from, to, classes) => {
      for (const cls of classes.split(' ')) {
        out.set(cls, [...(out.get(cls) ?? []), doc.slice(from, to)]);
      }
    },
  );
  return out;
}

test('a js fence is tokenized', () => {
  const t = tokens('```js\nconst x = "hi"; // note\n```\n');
  assert.deepEqual(t.get('tok-keyword'), ['const']);
  assert.deepEqual(t.get('tok-string'), ['"hi"']);
  assert.deepEqual(t.get('tok-comment'), ['// note']);
});

test('a python fence uses the python mode (# is a comment, not a heading)', () => {
  const t = tokens('```py\n# note\nx = 1\n```\n');
  assert.deepEqual(t.get('tok-comment'), ['# note']);
  assert.deepEqual(t.get('tok-number'), ['1']);
});

test('an unlisted language stays plain text', () => {
  const t = tokens('```brainfuck\n+++[->+<]\n```\n');
  // Only markdown's own fence tokens, nothing from a nested mode.
  assert.deepEqual([...t.keys()].sort(), ['tok-labelName', 'tok-meta']);
});

test('a json fence marks object keys as properties', () => {
  // The javascript mode this used to alias tags a quoted key as a plain string.
  const t = tokens('```json\n{"a": 1}\n```\n');
  assert.deepEqual(t.get('tok-propertyName'), ['"a"']);
  assert.deepEqual(t.get('tok-number'), ['1']);
});

test('every shipped language highlights its own comment syntax', () => {
  const comments: Record<string, string> = {
    js: '// c', ts: '// c', py: '# c', c: '/* c */', 'c++': '// c',
    java: '// c', cs: '// c', kt: '// c', scala: '// c', dart: '// c',
    objc: '// c', bash: '# c', rs: '// c', go: '// c', yml: '# c', toml: '# c',
  };
  for (const [lang, comment] of Object.entries(comments)) {
    const t = tokens('```' + lang + '\n' + comment + '\n```\n');
    assert.deepEqual(t.get('tok-comment'), [comment], `${lang} comment`);
  }
});

test('aliases resolve to their language', () => {
  for (const [alias, expected] of [
    ['js', 'javascript'], ['tsx', 'typescript'], ['py', 'python'],
    ['bash', 'shell'], ['rs', 'rust'], ['yml', 'yaml'], ['c++', 'cpp'],
    ['cs', 'csharp'], ['kt', 'kotlin'], ['objc', 'objective-c'],
  ]) {
    const found = LanguageDescription.matchLanguageName(codeLanguages, alias, true);
    assert.equal(found?.name, expected, `alias ${alias}`);
  }
});

test('editor.ts passes these languages to markdown()', () => {
  // Read as text, not imported: editor.ts resolves './live-preview' as a
  // directory, which Vite does and the node test runner does not. Crude, but it
  // is the only thing standing between `codeLanguages: []` and every test in
  // this file still passing while highlighting silently disappears.
  const src = readFileSync(new URL('../editor.ts', import.meta.url), 'utf8');
  // `codeLanguages` followed by `,` or `}` -- the shorthand that passes this
  // module. `codeLanguages: []` must not satisfy it; that is the regression.
  assert.match(src, /markdown\(\{[^}]*\bcodeLanguages\s*[,}][^}]*\}\)/);
});
