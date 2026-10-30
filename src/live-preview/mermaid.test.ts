import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { buildMermaid } from './decorations.ts';
import { MermaidWidget } from './widgets/mermaid.ts';

// The source each drawn ```mermaid block is drawn from.
function drawn(doc: string, cursor = 0): string[] {
  const s = EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown({ base: markdownLanguage })] });
  ensureSyntaxTree(s, s.doc.length, 5000);
  const out: string[] = [];
  buildMermaid(s).between(0, s.doc.length, (_f, _t, deco) => {
    const widget = (deco.spec as { widget?: unknown }).widget;
    if (widget instanceof MermaidWidget) out.push(widget.source);
  });
  return out;
}

// The issue's own example (#50).
const PIE = 'pie title NETFLIX\n  "Time spent looking for movie" : 90\n  "Time spent watching it" : 10';

test('a closed ```mermaid block is drawn from its body', () => {
  assert.deepEqual(drawn(`x\n\n\`\`\`mermaid\n${PIE}\n\`\`\`\n`), [PIE]);
});

test('the source shows while the selection touches the block', () => {
  assert.deepEqual(drawn(`\`\`\`mermaid\n${PIE}\n\`\`\``, 5), []);
});

test('other fences, unclosed and empty blocks stay code', () => {
  assert.deepEqual(drawn(`x\n\n\`\`\`js\n${PIE}\n\`\`\``), []);
  assert.deepEqual(drawn(`x\n\n\`\`\`mermaid\n${PIE}`), []);
  assert.deepEqual(drawn('x\n\n```mermaid\n\n```'), []);
});
