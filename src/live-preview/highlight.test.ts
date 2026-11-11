import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { highlight } from './highlight.ts';

// The parser extension alone: every node of the given name, as its source text
// and the name of the node around it.

function find(doc: string, name: string): { text: string; parent: string | undefined }[] {
  const s = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: [highlight] })],
  });
  const out: { text: string; parent: string | undefined }[] = [];
  ensureSyntaxTree(s, s.doc.length, 5000)!.iterate({
    enter: (n) => {
      if (n.name === name) out.push({ text: s.doc.sliceString(n.from, n.to), parent: n.node.parent?.name });
    },
  });
  return out;
}

const highlights = (doc: string): string[] => find(doc, 'Highlight').map((n) => n.text);

test('basic: the text between the == is a Highlight, the == its marks', () => {
  assert.deepEqual(highlights('a ==hi== b'), ['==hi==']);
  assert.deepEqual(find('a ==hi== b', 'HighlightMark').map((n) => n.text), ['==', '==']);
});

test('each color emoji, and no emoji, parse as a highlight with the emoji in its text', () => {
  for (const emoji of ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣']) {
    assert.deepEqual(highlights(`==${emoji}Important==`), [`==${emoji}Important==`], emoji);
  }
  assert.deepEqual(highlights('==Important=='), ['==Important==']);
});

test('nesting: a highlight in bold, and emphasis in a highlight', () => {
  const bold = find('**bold ==hi== text**', 'Highlight');
  assert.deepEqual(bold.map((n) => [n.text, n.parent]), [['==hi==', 'StrongEmphasis']]);
  const italic = find('==a *b* c==', 'Emphasis');
  assert.deepEqual(italic.map((n) => [n.text, n.parent]), [['*b*', 'Highlight']]);
});

test('a backslash escapes the =, and the escaped pair is not a delimiter', () => {
  assert.deepEqual(highlights(String.raw`\==not highlighted\==`), []);
  assert.deepEqual(highlights(String.raw`a \== b ==c==`), ['==c==']);
});

test('a single = and a === run are not delimiters', () => {
  assert.deepEqual(highlights('a =b= c'), []);
  assert.deepEqual(highlights('===x==='), []);
  assert.deepEqual(highlights('a===b===c'), []);
});

test('inside inline code it is not parsed', () => {
  assert.deepEqual(highlights('`==x==`'), []);
  assert.equal(find('`==x==`', 'InlineCode').length, 1);
});

test('an unclosed == is not highlighted', () => {
  assert.deepEqual(highlights('a ==text'), []);
});

test('a space after the opening == is not a highlight', () => {
  assert.deepEqual(highlights('a == text==  b'), []);
});

test('a highlight runs across a soft line break within a paragraph', () => {
  assert.deepEqual(highlights('a ==one\ntwo== b'), ['==one\ntwo==']);
});
