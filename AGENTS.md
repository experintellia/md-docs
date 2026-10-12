# Notes for agents

Design and roadmap are in [`PLAN.md`](./PLAN.md). `npm test` runs typecheck,
lint and unit tests; `npm run test:e2e` runs Playwright against the built
bundle.

## Upgrading CodeMirror's HTML support

`vite.config.ts` aliases `@codemirror/lang-javascript` to
`src/lang-javascript-lite.ts`. Nothing of ours imports lang-javascript;
`@codemirror/lang-markdown` → `@codemirror/lang-html` does, only to highlight
raw `<script>` blocks, and the stand-in swaps its 34 KB Lezer grammar for the
legacy JS mode the code fences already bundle. It provides just what lang-html
uses today.

After any change that moves `@codemirror/lang-html` or
`@codemirror/lang-markdown` (a direct upgrade or a lockfile refresh):

- `npm run build` fails if lang-html imports a name the stand-in doesn't export.
- If lang-html uses a new *property* of what it imports, nothing fails until
  runtime. A crash at load fails `npm run test:e2e`; a crash on use doesn't, so
  also open the built app, type a `<script>` block into a note, and check it
  is highlighted with a clean console.
- If it breaks, extend the stand-in, or drop the alias and accept the size.

## Unit tests must not leave timers running

A test that creates a Yjs `Awareness` must `destroy()` it, or its timer keeps
the file's process alive and `npm test` hangs. Don't add `--test-force-exit`:
it ends the run before slower files have reported, silently dropping tests.
