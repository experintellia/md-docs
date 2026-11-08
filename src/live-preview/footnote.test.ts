import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { footnote } from './footnote.ts';

// Footnote syntax, as the parser reads it. Headless like math.test.ts.

function tree(doc: string) {
  const s = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: [footnote] })],
  });
  return ensureSyntaxTree(s, s.doc.length, 5000)!;
}

// Every node below the document, in order. The footnote marks and labels carry
// their text, as `Name:text`, so the test can see which brackets were taken.
function nodes(doc: string): string[] {
  const out: string[] = [];
  tree(doc).iterate({
    enter: (n) => {
      if (n.name === 'Document') return;
      out.push(/^Footnote(Mark|Label)$/.test(n.name) ? `${n.name}:${doc.slice(n.from, n.to)}` : n.name);
    },
  });
  return out;
}

// The source text of the first node with this name, or undefined.
function text(doc: string, name: string): string | undefined {
  let found: string | undefined;
  tree(doc).iterate({
    enter: (n) => {
      if (found === undefined && n.name === name) found = doc.slice(n.from, n.to);
    },
  });
  return found;
}

const count = (doc: string, name: string): number => nodes(doc).filter((n) => n === name).length;

test('a reference is a FootnoteReference, its brackets marked apart from its label', () => {
  assert.deepEqual(nodes('This is a simple footnote[^1].'), [
    'Paragraph', 'FootnoteReference', 'FootnoteMark:[^', 'FootnoteLabel:1', 'FootnoteMark:]',
  ]);
});

test('a named reference is a FootnoteReference too', () => {
  assert.deepEqual(nodes('And a named one[^note].'), [
    'Paragraph', 'FootnoteReference', 'FootnoteMark:[^', 'FootnoteLabel:note', 'FootnoteMark:]',
  ]);
});

test('a definition is a block: its marker, then its text parsed as inline', () => {
  assert.deepEqual(nodes('[^1]: This is the referenced text.'), [
    'FootnoteDefinition', 'FootnoteMark:[^', 'FootnoteLabel:1', 'FootnoteMark:]:',
  ]);
});

test('a definition continued by lines indented two columns takes them in', () => {
  const doc = '[^2]: Add 2 spaces at the start of each new line.\n  This lets you write footnotes that span multiple lines.\n\nafter';
  assert.equal(text(doc, 'FootnoteDefinition'), doc.slice(0, doc.indexOf('\n\n')));
  assert.equal(count(doc, 'FootnoteDefinition'), 1);
  assert.equal(nodes(doc).pop(), 'Paragraph', '`after` is a paragraph of its own');
});

test('a tab counts as an indent for a continuation line', () => {
  assert.equal(text('[^1]: a\n\tb', 'FootnoteDefinition'), '[^1]: a\n\tb');
});

test('an unindented line ends a definition', () => {
  const doc = '[^1]: a\n  b\nplain';
  assert.equal(text(doc, 'FootnoteDefinition'), '[^1]: a\n  b');
  assert.equal(nodes(doc).pop(), 'Paragraph');
});

test('a blank line ends a definition, and an indented line after it is no continuation', () => {
  const doc = '[^1]: a\n  b\n\n  c';
  assert.equal(text(doc, 'FootnoteDefinition'), '[^1]: a\n  b');
  assert.equal(nodes(doc).pop(), 'Paragraph');
});

test('a definition at the start of the next line begins a definition of its own', () => {
  assert.equal(count('[^1]: a\n[^2]: b', 'FootnoteDefinition'), 2);
});

test('a definition right under a paragraph line ends the paragraph', () => {
  const doc = 'text[^1]\n[^1]: note';
  assert.equal(text(doc, 'FootnoteDefinition'), '[^1]: note');
  assert.equal(text(doc, 'Paragraph'), 'text[^1]');
});

test('the example from the feature request parses as written', () => {
  const doc = [
    'This is a simple footnote[^1]. And a named one[^note].',
    '',
    '[^1]: This is the referenced text.',
    '[^2]: Add 2 spaces at the start of each new line.',
    '  This lets you write footnotes that span multiple lines.',
    '[^note]: Named footnotes still appear as numbers.',
    '',
    'You can also use inline footnotes. ^[This is an inline footnote.]',
  ].join('\n');
  assert.equal(count(doc, 'FootnoteDefinition'), 3);
  assert.equal(count(doc, 'FootnoteReference'), 2);
  assert.equal(count(doc, 'InlineFootnote'), 1);
});

test('an inline footnote is `^[` and `]` around its note', () => {
  assert.deepEqual(nodes('Text ^[This is an inline footnote.] more'), [
    'Paragraph', 'InlineFootnote', 'FootnoteMark:^[', 'FootnoteMark:]',
  ]);
});

test('brackets inside an inline footnote balance, and a backslash escapes one', () => {
  assert.equal(text('a ^[x [y] z] b', 'InlineFootnote'), '^[x [y] z]');
  assert.equal(text(String.raw`a ^[x \] y] b`, 'InlineFootnote'), String.raw`^[x \] y]`);
});

test('an inline footnote unclosed, or empty, is no footnote', () => {
  assert.equal(count('a ^[x and more', 'InlineFootnote'), 0);
  assert.equal(count('a ^[] b', 'InlineFootnote'), 0);
});

test('`[^ 1]` and `[^]` are not footnotes', () => {
  for (const doc of ['[^ 1] and [^]', 'a [^a b] c', 'a [^] c']) {
    assert.equal(count(doc, 'FootnoteReference'), 0, doc);
    assert.equal(count(doc, 'FootnoteDefinition'), 0, doc);
  }
});

test('an escaped `\\[^1]` is not a footnote', () => {
  assert.equal(count(String.raw`text \[^1] here`, 'FootnoteReference'), 0);
});

test('ordinary links are still links', () => {
  assert.ok(nodes('[a](b)').includes('Link'));
  assert.equal(count('[a](b)', 'FootnoteReference'), 0);
  // `[a]` is a link once a definition gives it a destination.
  const doc = '[a]\n\n[a]: http://x';
  assert.ok(nodes(doc).includes('Link'));
  assert.ok(nodes(doc).includes('LinkReference'));
  assert.equal(count(doc, 'FootnoteDefinition'), 0);
});

test('a real link reference is still a LinkReference, not a definition', () => {
  const doc = '[a]: http://x';
  assert.ok(nodes(doc).includes('LinkReference'));
  assert.equal(count(doc, 'FootnoteDefinition'), 0);
});

test('nothing inside inline code or a fenced block is a footnote', () => {
  assert.equal(count('`[^1]` and `^[x]`', 'FootnoteReference'), 0);
  assert.equal(count('`[^1]` and `^[x]`', 'InlineFootnote'), 0);
  assert.ok(nodes('`[^1]`').includes('InlineCode'));
  const fenced = '```\n[^1]: note\n  more\n```';
  assert.ok(nodes(fenced).includes('FencedCode'));
  assert.equal(count(fenced, 'FootnoteDefinition'), 0);
});

test('a reference inside a list item or a blockquote', () => {
  assert.ok(nodes('- item[^1]').includes('ListItem'));
  assert.equal(count('- item[^1]', 'FootnoteReference'), 1);
  assert.ok(nodes('> quote^[x]').includes('Blockquote'));
  assert.equal(count('> quote^[x]', 'InlineFootnote'), 1);
});

test('a definition in a blockquote is a definition', () => {
  const doc = '> [^1]: note\n>   more\n\nafter';
  assert.ok(nodes(doc).includes('Blockquote'));
  assert.equal(count(doc, 'FootnoteDefinition'), 1);
});

test('bold inside a definition and inside an inline footnote is parsed', () => {
  assert.ok(nodes('[^1]: a **bold** b').includes('StrongEmphasis'));
  assert.ok(nodes('x ^[a **bold** note]').includes('StrongEmphasis'));
});
