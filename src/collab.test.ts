import { strict as assert } from 'node:assert';
import { titleFromMarkdown } from './collab';

// Run with: npx tsx src/collab.test.ts
const cases: [string, string][] = [
  ['# My notes', 'My notes'],
  ['### **Draft** `v2`', 'Draft v2'],
  ['- [ ] buy milk', 'buy milk'],
  ['> a quote', 'a quote'],
  ['see [the docs](https://x.y) now', 'see the docs now'],
  ['*emphasis* and __strong__', 'emphasis and strong'],
  ['plain text', 'plain text'],
];

for (const [input, want] of cases) {
  assert.equal(titleFromMarkdown(input), want, `titleFromMarkdown(${JSON.stringify(input)})`);
}
console.log(`ok — ${cases.length} cases`);
