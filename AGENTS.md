# Notes for agents

Design and roadmap are in [`PLAN.md`](./PLAN.md). `npm test` runs typecheck,
lint and unit tests; `npm run test:e2e` runs Playwright against the built
bundle.

## Upgrading CodeMirror's HTML support

`vite.config.ts` aliases `@codemirror/lang-javascript` to
`src/lang-javascript-lite.ts`. Nothing of ours imports lang-javascript;
`@codemirror/lang-markdown` → `@codemirror/lang-html` does, only to highlight
raw `<script>` blocks and `on*=` attributes, and the stand-in swaps its 34 KB
Lezer grammar for the legacy JS mode the code fences already bundle. It
provides just what lang-html uses today.

After any change that moves `@codemirror/lang-html` or
`@codemirror/lang-markdown` (a direct upgrade or a lockfile refresh):

- `npm run build` fails if lang-html imports a name the stand-in doesn't export.
- If lang-html uses a new *property* of what it imports, nothing fails until
  runtime — at load, or only once a `<script>` block is typed. `npm run
  test:e2e` covers both (`a raw <script> block is highlighted like a ```js
  fence` in `e2e/app.spec.ts`), and CI runs it on every pull request.
- If it breaks, extend the stand-in, or drop the alias and accept the size.

## Unit tests must not leave timers running

A test that creates a Yjs `Awareness` must `destroy()` it, or its timer keeps
the file's process alive and `npm test` hangs (CI gives up after 10 minutes).
happy-dom test files get this for free from
`after(() => GlobalRegistrator.unregister())`, which clears every timer, so
keep that line.

Don't add `--test-force-exit` instead. It stops the reporter before it has
printed every result: each run reports a different subset of the tests, and a
failure can show only as a failed file with no test name. `--test-timeout`
doesn't catch a leaked timer either.
