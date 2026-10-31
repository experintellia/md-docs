# Credits & inspiration

MD-Docs implements its own markdown live-preview layer on top of CodeMirror 6.
The approach was **inspired by** the projects below. We studied them for ideas
only and wrote our own implementation — **no code was copied**.

- **Ixora** — `@retronav/ixora` (Apache-2.0)
  <https://codeberg.org/retronav/ixora> — reference for structuring CodeMirror 6
  markdown decorations.
- **Atomic Editor** — `@atomic-editor/editor` (MIT), by Kenny Bergquist (kenforthewin)
  <https://github.com/kenforthewin/atomic-editor> — reference for Obsidian-style
  inline live-preview and widget patterns.
- **codemirror-rich-markdoc**, by segphault
  <https://github.com/segphault/codemirror-rich-markdoc> — hide-syntax and
  block-widget patterns.
- **HyperMD**, by laobubu (CodeMirror 5)
  <https://github.com/laobubu/HyperMD> — the conceptual ancestor of WYSIWYG-style
  markdown editing in CodeMirror.

## Built on

- [CodeMirror 6](https://codemirror.net/) and `@codemirror/lang-markdown` / `@lezer/markdown`
- [Pele](https://pele.run/) — Mermaid diagrams
- [Yjs](https://yjs.dev/) with `y-codemirror.next`
- [`y-webxdc`](https://codeberg.org/webxdc/y-webxdc) — the webxdc Yjs provider
- The [webxdc](https://webxdc.org/) platform and `webxdc-dev`

This project is itself influenced by `webxdc/editor` and its `durian/editor` fork.

## Licenses

MD-Docs itself is MIT-licensed (see [`LICENSE`](./LICENSE)). Its bundled
dependencies are MIT, apart from two:

- `js-base64` (a Yjs dependency) is BSD-3-Clause.
- The [Font Awesome Free](https://fontawesome.com) icons are CC BY 4.0, by
  Fonticons, Inc.; their code is MIT.

`npm run build` writes every bundled package's license notice into the `.xdc`
as `THIRD-PARTY-LICENSES.txt` (see `thirdPartyLicenses()` in `vite.config.ts`).

The math fonts in `fonts/katex-*/` are KaTeX's own (MIT, Khan Academy and
contributors), with TrueType hinting and glyph names removed by
`scripts/strip-katex-fonts.py`.

The app icon (`public/icon.png`) is AI-generated.
