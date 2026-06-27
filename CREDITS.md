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
- [Yjs](https://yjs.dev/) with `y-codemirror.next`
- [`y-webxdc`](https://codeberg.org/webxdc/y-webxdc) — the webxdc Yjs provider
- The [webxdc](https://webxdc.org/) platform and `webxdc-dev`

This project is itself influenced by `webxdc/editor` and its `durian/editor` fork.
