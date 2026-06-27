import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { titleFromMarkdown } from './collab.ts';

test('titleFromMarkdown reduces a markdown line to plaintext', () => {
  const cases: [string, string][] = [
    ['# My notes', 'My notes'],
    ['### **Draft** `v2`', 'Draft v2'],
    ['- [ ] buy milk', 'buy milk'],
    ['> a quote', 'a quote'],
    ['see [the docs](https://x.y) now', 'see the docs now'],
    ['*emphasis* and __strong__', 'emphasis and strong'],
    ['plain text', 'plain text'],
  ];
  for (const [input, want] of cases)
    assert.equal(titleFromMarkdown(input), want, `titleFromMarkdown(${JSON.stringify(input)})`);
});
