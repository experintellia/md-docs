# Plan: MD-Docs — Obsidian-style collaborative markdown editor (webxdc, CodeMirror 6)

> Name: **MD-Docs** ("markdown document app", placeholder). Language: **TypeScript**.

## Context

We are starting a **new project**: a collaborative markdown editor that runs as a
**webxdc app** (a sandboxed, offline, fully-bundled `.xdc` that runs inside Delta
Chat and other webxdc-capable messengers). The motivation is dissatisfaction with the
existing `webxdc/editor` (a plain ProseMirror rich-text editor) and its fork
`durian/editor` (same editor + an inlined, frozen copy of the sync library with
real-time bolted on).

Target experience: **Obsidian-like "Live Preview"** — a single editing surface showing
raw markdown that renders formatting inline as you type, with syntax markers revealed
only when the cursor is on them. Obsidian achieves this with **CodeMirror 6 (CM6) +
decorations**, not a WYSIWYG framework. We deliberately choose CM6 (over Milkdown/
ProseMirror) to get the authentic source-preserving live-preview feel, accepting that
the decoration layer is custom work.

**Scope decisions (locked):**
- Editor engine: **CodeMirror 6** (because Obsidian uses CM6).
- Live preview: **we write our own minimal markdown styling/preview layer**, *inspired by*
  `@retronav/ixora` and Atomic Editor (kenforthewin) but **not copied** — clean-room,
  minimal, and we credit both as inspiration in CREDITS. We do **not** take Ixora as a
  dependency.
- Binding: **`y-codemirror.next`** wired with **both undo and awareness** (a
  `Y.UndoManager` for local undo/redo + an `awareness` instance passed to `yCollab`).
- UI: **custom responsive editing toolbar.** On **mobile** it docks above the on-screen
  keyboard (a "keyboard accessory bar", like Obsidian's mobile toolbar); on **desktop**
  it sits at the **top of the screen**. Touch-friendly quick actions since you can't
  easily type markdown syntax / use Ctrl-B on a phone. v1 actions: heading, bold, italic,
  **list indent/outdent (Tab / Shift-Tab under the hood)**, and add/toggle checklist item.
- Language: **TypeScript** for all of `src/`.
- v1 markdown elements: headings, bold, italic, links, lists (incl. indent/outdent
  nesting), blockquotes, inline code, code blocks, task checkboxes. **Images and tables
  are deferred** (see Deferred below).
- Collaboration: document sync via Yjs through the **webxdc persistent channel** is in
  scope from the start (a webxdc editor is inherently a chat-shared document). The
  awareness instance is wired now so cursors are renderable; the **live real-time
  presence transport (`joinRealtimeChannel`) is deferred** to a later phase.
- Deliverable now: a **project folder + this iterable plan**, then hand off to
  implementation.

## Architecture (three layers, two of which exist now)

1. **Editor** — CM6 + `@codemirror/lang-markdown` (Lezer parser) + **our own minimal
   live-preview decoration layer** (clean-room, inspired by Ixora & Atomic Editor,
   credited). Plus a **custom shell UI** with a mobile editing toolbar above the keyboard.
2. **Collaboration transport** — Yjs `Y.Doc` synced via **`y-webxdc`** (the maintained
   upstream provider, now v1.2.0) over `webxdc.sendUpdate`/`setUpdateListener`. Bound to
   the editor with **`y-codemirror.next`** `yCollab(ytext, awareness, { undoManager })`
   — **undo + awareness wired from the start**.
3. **Live real-time presence (LATER, not this phase)** — the **transport** for awareness
   goes live via `joinRealtimeChannel`. We add it as an **opt-in feature of `y-webxdc`**
   (contribute upstream / fork only if needed) rather than inlining like durian did, so
   the lib stays shared and maintained. The editor side already supplies the awareness
   instance to `yCollab`, so enabling the transport is what lights up remote cursors.

## Verified tech stack (versions confirmed live)

| Package | Version | Role | License |
|---|---|---|---|
| `codemirror` (meta) | 6.0.2 | CM6 bundle | MIT |
| `@codemirror/lang-markdown` | 6.5.0 | Markdown language/Lezer integration | MIT |
| `@lezer/markdown` | 1.6.4 | Markdown parser (syntax tree we walk) | MIT |
| `yjs` | 13.x | CRDT document + `Y.UndoManager` | MIT |
| `y-protocols` | 1.x | `awareness` instance for `yCollab` | MIT |
| `y-webxdc` | 1.2.0 | webxdc Yjs provider (persistent sync) | (codeberg.org/webxdc/y-webxdc) |
| `y-codemirror.next` | 0.3.5 | Yjs <-> CM6 binding (`yCollab`, undo + awareness) | MIT |
| `vite` | latest | bundler / dev | MIT |
| `typescript` + `@types/*` | latest | TS toolchain (`src` is TypeScript) | Apache-2.0 |

We write the live-preview decoration layer ourselves — **no editor/decoration library
dependency.**

**Inspiration only — clean-room, do NOT copy code; credit in CREDITS:**
- `@retronav/ixora` (Apache-2.0) — reference for CM6 markdown decoration structure.
- Atomic Editor `@atomic-editor/editor` (MIT, **React-based**) — reference for live-
  preview/widget patterns (cursor-reveal, images). We don't pull React into the bundle.
- `segphault/codemirror-rich-markdoc` — hide-syntax + block-widget patterns.
- `laobubu/HyperMD` — conceptual ancestor, **CodeMirror 5**, unmaintained; ideas only.
- ⚠️ The npm package literally named `ixora` (qeeqbox) is an **unrelated** project.

**webxdc packaging:** reuse the proven scaffold from `webxdc/editor` — its
`vite.config.js`, `public/manifest.toml`, and `.forgejo/workflows/release.yaml`
(build to `dist-release/*.xdc`, optional Eruda debug via `ERUDA=1`). Dev loop uses
`webxdc-dev` (`webxdc-dev run`).

## Proposed project folder

```
/home/dev/work/md-docs/              # display name: MD-Docs (placeholder)
  index.html
  package.json
  tsconfig.json                      # TypeScript config (src is TS)
  vite.config.ts                     # lifted from webxdc/editor, adjusted
  public/
    manifest.toml                    # name = "MD-Docs" + source_code_url
    icon.png
  css/
    main.css                         # base layout
    live-preview.css                 # decoration / theme styles
  src/
    main.ts                          # entry: build CM6 view, wire Yjs + provider + UI
    editor.ts                        # CM6 EditorState/EditorView setup + extensions
    ui/
      toolbar.ts                     # responsive editing toolbar (mobile: above keyboard;
                                     #   desktop: top of screen)
    commands.ts                      # markdown editing commands (toolbar + keymap dispatch)
    live-preview/                    # OUR clean-room Obsidian-style decoration layer
      index.ts                       # compose the extension(s)
      decorations.ts                 # ViewPlugin: walk syntax tree -> DecorationSet
      reveal-on-cursor.ts            # selection-driven filtering of hide decorations
      widgets/                       # checkboxes, code blocks (images + tables: LATER)
    collab.ts                        # Y.Doc + UndoManager + awareness + y-webxdc + yCollab
  PLAN.md                            # copy of this plan, for in-repo iteration
  CREDITS.md                         # inspiration attribution (Ixora, Atomic Editor, ...)
  README.md
  .forgejo/workflows/release.yaml    # from webxdc/editor
  .gitignore  .eslintrc.js  .eslintignore
```

## Implementation phases

**Phase 0 — Scaffold (small).**
Init folder, `package.json`, install the verified stack, lift `vite.config.js` +
`manifest.toml` + release workflow from `webxdc/editor`. Get a blank CM6 editor
rendering in `webxdc-dev` and producing a `.xdc` via `npm run build`. Acceptance:
empty editor loads, builds, opens in webxdc-dev.

**Phase 1 — Markdown editing + live preview (the bulk).**
- CM6 with `@codemirror/lang-markdown` (GFM `markdownLanguage`).
- Build **our own minimal, clean-room decoration layer** in `src/live-preview/` (read
  Ixora/Atomic Editor for *ideas only*, write our own; credit them in `CREDITS.md`):
  - `decorations.mjs`: ViewPlugin walking `syntaxTree(state)`; emit `Decoration.mark`
    (bold/italic/link/code), `Decoration.line` (heading sizes, blockquote), and
    `Decoration.replace` (hide `**`, `#`, list markers, link brackets).
  - `reveal-on-cursor.mjs`: on update, filter out hide-decorations overlapping any
    `state.selection.ranges` endpoint (the Obsidian "reveal raw syntax on cursor" trick).
  - `widgets/`: task-list `CheckboxWidget` (clickable toggle) + rendered code blocks via
    highlight. **Images and tables deferred** (see Deferred). Lists support indent/outdent
    nesting functionally; *visual* polish of deeply nested lists deferred (see below).
- `live-preview.css` + `EditorView.theme` + `syntaxHighlighting(HighlightStyle...)`.
- **Markdown editing commands** (`src/commands.mjs`): CM6 commands operating on the
  active selection/line — toggle heading, toggle bold (`**`), toggle italic (`*`),
  indent/outdent list item (CM6 `indentMore`/`indentLess` — Tab/Shift-Tab), add/toggle
  checklist item (`- [ ] ` / toggle `[ ]`<->`[x]`). Also bound to keyboard shortcuts.
- **Responsive editing toolbar** (`src/ui/toolbar.ts`): the same buttons rendered in two
  placements — on **mobile**, docked above the on-screen keyboard, positioned via the
  **VisualViewport API** (`window.visualViewport` resize/scroll → offset the bar to sit on
  top of the keyboard); on **desktop**, fixed at the **top of the screen**. Each button
  dispatches a `commands.ts` command on the active selection.
Acceptance: typing markdown shows live formatting; moving the cursor onto a token reveals
its raw syntax; headings/bold/italic/links/lists/quotes/inline-code/checkboxes work; the
toolbar applies heading/bold/italic/indent/outdent/checklist to the current selection,
sitting above the keyboard on mobile and at the top on desktop.

**Phase 2 — Collaboration via Yjs + y-webxdc, with undo + awareness (medium).**
- `collab.mjs`: create `Y.Doc`; create a `Y.UndoManager` over the ytext and an
  `awareness` instance (`y-protocols/awareness`); instantiate `y-webxdc` `WebxdcProvider`
  (`{ webxdc, ydoc, getEditInfo, autosaveInterval }`); bind with `y-codemirror.next`
  `yCollab(ytext, awareness, { undoManager })` so **undo/redo and awareness-ready cursors
  are wired**. Note upstream provider API is `onEnqueued`/`onFlushed` (the `.on('sync')`
  API was removed) — use it to drive a small "saved/changed" indicator (a corner element,
  not the toolbar).
- `getEditInfo` returns `{document, summary, startinfo}` (first line as title, etc.),
  mirroring the original editor.
- Note: awareness/cursors won't go *live* between peers until the Phase-LATER realtime
  transport lands (persistent channel alone is too slow for live cursors); the wiring is
  in place so that flip is small.
Acceptance: two webxdc-dev instances edit the same doc and converge; undo/redo works and
respects remote edits; reopening reloads content; no server involved.

**Phase 3 — Packaging & polish (small).**
Icon, manifest name/url, README (build + release instructions), Eruda debug build,
`.xdc` size check (bundle stays reasonable for offline transport).

**LATER (out of scope now) — Live presence transport.**
The awareness instance is already passed into `yCollab` (Phase 2), so this phase is just
the **transport**: add `joinRealtimeChannel` + awareness encoding as an **opt-in
`y-webxdc` feature** to make cursors/presence go live between peers. Fix the gaps the
durian prototype had: call `channel.leave()` / clean up on `destroy`, initial-state sync
when a peer joins the ephemeral channel, and error/fallback handling on best-effort
realtime sends.

## Hard parts / risks (call out early)

- **Our own decoration layer is the real work** (~hundreds–~1–2k lines). Tables, nested
  lists, and performance on large docs (viewport-incremental `DecorationSet` rebuilds)
  are the known-hard items — keep v1 minimal; defer tables/nested-list polish.
- **Clean-room discipline:** read Ixora/Atomic Editor for ideas, but write our own code
  and credit them in `CREDITS.md` — no copy-paste, no plagiarism.
- **`y-codemirror.next` is maintained but slow-moving** (v0.3.5, last npm release 2024).
  Pin it; watch for the Yjs v14 transition (stay on Yjs v13 for now).
- **Bundle size**: everything ships inside the `.xdc`; keep deps lean (no React; prefer
  small/no syntax-highlight lib initially).
- **No git repo yet** (`/home/dev/work` is not a repo) — Phase 0 should `git init` the
  project folder so the `.forgejo` release-by-tag flow works later.

## Verification (how to test end-to-end)

- **Dev:** `npm start` (→ `webxdc-dev run`), open the served URL, edit, confirm live
  preview. Open a second simulated peer in webxdc-dev to test convergence (Phase 2+).
- **Build:** `npm run build` → produces `dist-release/<name>.xdc`; send to a Delta Chat
  group and confirm shared editing.
- **Debug:** `ERUDA=1 npm run build` for an on-device console.
- **Lint:** `npm test` / `npm run check` (eslint), matching the upstream editor's setup.

## Credits / attribution (we are inspired by, not copying)

`CREDITS.md` will acknowledge `@retronav/ixora` and Atomic Editor (kenforthewin) as
**inspiration** for the live-preview approach, plus HyperMD / codemirror-rich-markdoc.
We implement our own minimal version from CM6 primitives — **no copied code, no
plagiarism.**

## Decisions (resolved)

1. **Name:** MD-Docs (placeholder, "markdown document app") → folder `md-docs`.
2. **Language:** TypeScript for `src/`.
3. **v1 markdown scope:** headings, bold, italic, links, lists (with indent/outdent
   nesting), blockquotes, inline code, code blocks, task checkboxes. Images + tables
   deferred.
4. **Toolbar:** responsive — mobile above the keyboard, desktop at the top. v1 buttons:
   heading, bold, italic, list indent/outdent, add/toggle checklist.

## Deferred for later (with reasons)

- **Images** — in webxdc the `.xdc` ships offline and messages have size limits, so
  embedded/pasted images need either a **compression option** or at minimum a **clear
  "image too large" disclaimer/warning**. Decide the UX before adding image rendering;
  not in v1. *(Write this down — it's the main reason images are out of v1.)*
- **Tables** — hardest CM6 widget (cell editing, sizing); not in v1.
- **Nested-list visual polish** — clarification: indent/outdent *works* in v1 (it creates
  real nested lists via Tab/Shift-Tab). "Polish" = making *deeply* nested lists *look*
  clean (consistent indent guides, bullet alignment, cursor behavior across levels).
  Functional nesting now; cosmetic fine-tuning of deep nesting later.
- **Live presence transport** — `joinRealtimeChannel` + awareness encoding as an opt-in
  `y-webxdc` feature (awareness is already wired into `yCollab`, so this is the flip that
  makes remote cursors go live). See the LATER phase above.

## Open questions (remaining)

- Optional toolbar buttons: also add **link** and/or **inline-code** buttons in v1, or
  keep to the five core actions? (Default: keep the five; add later.)
