import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

// The live-preview stylesheet paints document text that may run right-to-left
// (each line carries its own `dir`, see decorations.ts). A physical side puts
// the quote bar or the bullet gap on the wrong edge of an RTL line, and no
// behavioural test would notice — jsdom and happy-dom do no layout — so the
// check is on the file.
//
// ponytail: a regex, not a CSS parser. It reads declarations, not rules, so it
// knows nothing about selectors, nesting or a `;` inside a quoted value.
const css = readFileSync(new URL('../../css/live-preview.css', import.meta.url), 'utf8');

// Physical but direction-neutral, by exact declaration.
const ALLOWED = [
  'left: 50%', // centring, paired with a translate(-50%)
  'border-width: 0 2px 2px 0', // the tick's shape; a checkmark does not mirror
  'right: 0.4em', // the copy button; fence lines are always ltr, so right trails
  // The quote bar. Its side comes from the quote's direction, written out by
  // decorations.ts as md-quote-ltr / md-quote-rtl — a logical side would
  // resolve per line, and a quote may hold lines of both directions.
  'border-left: 3px solid var(--border)',
  'padding-left: 0.7em',
  'border-right: 3px solid var(--border)',
  'padding-right: 0.7em',
];

test('live-preview styles take their sides from the text direction', () => {
  const offenders = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/[{};]/)
    .map((chunk) => chunk.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter((chunk) => /^[a-z-]+\s*:/.test(chunk))
    .map((chunk) => [chunk.slice(0, chunk.indexOf(':')).trim(), chunk.slice(chunk.indexOf(':') + 1).trim()])
    .filter(([prop, value]) =>
      // A side in the name (`margin-left`, `border-right-color`, `right`), or a
      // four-value shorthand that sets left and right differently.
      /(?:^|-)(?:left|right)(?:-(?!radius)|$)/.test(prop) ||
      (/^(?:margin|padding|inset|border-width)$/.test(prop) &&
        value.split(' ').length === 4 &&
        value.split(' ')[1] !== value.split(' ')[3]))
    .map(([prop, value]) => `${prop}: ${value}`)
    .filter((decl) => !ALLOWED.includes(decl));

  assert.deepEqual(offenders, [], 'use inline-start / inline-end so RTL lines mirror');
});

test('the quote bar is stated on both side classes', () => {
  // The class alone fixes nothing: the side has to be in the stylesheet, and
  // physically, since a logical one resolves against each line's direction.
  // Reverting the CSS to a logical side used to pass every test.
  const rule = (selector: string): string =>
    new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  assert.match(rule('.cm-line.md-quote-ltr'), /border-left:\s*3px/, 'left bar for an LTR quote');
  assert.match(rule('.cm-line.md-quote-rtl'), /border-right:\s*3px/, 'right bar for an RTL quote');
});
