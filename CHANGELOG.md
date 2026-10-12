# Changelog

All notable changes to MD-Docs are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Playwright end-to-end tests (`e2e/`, `npm run test:e2e`) against the built
  bundle: live preview, highlighting in raw `<script>` blocks, toolbar and
  checkboxes under touch, persistence across a relaunch, and two peers syncing.
  `.github/workflows/e2e.yml` runs them on Chromium (desktop and Android
  emulation) on Linux and on WebKit (desktop and iPhone emulation) on macOS.
- An end-to-end test of the poison-batch guard with the real batch from #19,
  and one that settles #22 for single-process engines: Chromium commits
  `localStorage` about 5 s after a write, so an abort sooner than that after
  the note loses it and the document stays bricked. The test pins that
  behaviour so a fix shows up as a failure to flip.
- Math blocks: LaTeX between `$$` lines (or `$$ x^2 $$` on one line) is typeset
  with KaTeX while the cursor is elsewhere, and shows as source, styled like a
  code block, while you edit it. Tap a formula to edit it. Half-typed TeX shows
  as a red error in place. KaTeX loads the first time a document shows math, so
  documents without math open as before. A note cannot define macros (`\def`,
  `\newcommand`, …): the TeX comes from other chat members, and a macro lets a
  few bytes take minutes to typeset. The `.xdc` grows by 239 KB, mostly KaTeX's
  fonts; see `docs/math-rendering.md` for the size work. (#27)
- End-to-end tests for past bugs that lived between modules, in CSS, or in a
  real engine, where the unit tests cannot see them: a reopen or a watching
  peer publishing an edit nobody made (0.1.11), a second device starting with
  an empty editor, the app on Delta Chat's read-only `webxdc` object, a failed
  device draft showing "no device backup" (#26), restoring a version through
  the in-app dialog (0.1.8), selections in code staying visible (0.2.0), and
  the phone layout's status line and checkbox size (0.1.6). Each was checked
  by putting its bug back and watching the test fail.
- A unit test for a large document's realtime catch-up, which once overflowed
  the call stack by spreading the frame into call arguments.
- Read mode. The book button in the toolbar switches the editor to reading:
  no keyboard, no caret, and no line turns back into its markdown, so a tap on
  a link opens it instead of starting an edit. The formatting buttons step
  aside while reading; the pen button switches back. Read mode is local to
  you: peers keep editing and their changes keep arriving, and your cursor
  leaves their screens until you edit again. (#32)

### Changed
- The `.xdc` is about half the size: 400 KB → 210 KB, with no feature removed.
  - The app icon was a 1254 px truecolor PNG taking 40% of the file. It is now
    512 px with a 64-colour palette (165 KB → 9 KB) and looks the same.
  - Raw `<script>` blocks in a note were highlighted with the full Lezer
    JavaScript grammar, which markdown support pulls in through its HTML
    support. They now use the legacy JavaScript mode that ```` ```js ````
    fences already bundle (−34 KB), so they are highlighted the same way as
    those fences. `<style>` blocks and auto-closing HTML tags are unchanged.
  - The JavaScript is minified with terser instead of esbuild (−5 KB).
- On a phone, or any screen under 480px wide, history, theme and help fold
  into a ⋮ menu at the end of the toolbar, so the formatting row fits a 375px
  iPhone SE again. On an even narrower screen the row scrolls under the menu
  button, which stays pinned to the edge. (#32)
- On a screen up to 560px wide, help opens as a full screen with a back
  button, like the history view, instead of a card over the editor. Wider
  screens keep the dialog. (#32)
- Help's syntax list now runs from the toolbar's own buttons, in the
  toolbar's order, through links to the rarer blocks, and adds what the
  editor already rendered but the help never mentioned: strikethrough,
  numbered lists, fenced code blocks (with the language name that picks
  their highlighting) and tables. Multi-line examples (code, tables, math)
  show as one block, and the toolbar's buttons are a table instead of one
  long sentence. (#32)

### Fixed
- `npm test` dropped unit-test results: each run reported a different subset,
  mostly missing live-preview decoration tests, and a failure could show only
  as a failed file with no test name or message. `--test-force-exit` stopped
  the reporter before it had printed everything; it was only there because the
  realtime tests never destroyed their Yjs `Awareness`, whose timer kept the
  process alive. They do now, and the flag is gone. CI's `check` job now gives
  up after 10 minutes, in case a test leaks a timer again.
- The history viewer revealed a line's markdown wherever you selected text,
  and ticking a task box there changed the version on screen. A read-only
  view now reveals nothing and leaves its tasks alone. (#32)
- In a desktop window too narrow for the toolbar, the toolbar showed a
  vertical scrollbar beside its horizontal one: the horizontal scrollbar took
  its height out of the bar and squeezed the buttons. The bar now grows by
  the scrollbar's height instead. (#32)

## [0.3.1] - 2026-09-19

### Fixed
- A link destination is peer-controlled, and `[click me](javascript:…)` was
  clickable. Only `http(s):` and `mailto:` links open now; anything else is
  left unclickable. `<mailto:a@b.com>` and bare email autolinks resolve to
  `mailto:` instead of a dead `https://mailto:…` link. (#14)
- Links in `[![alt](img)](href)` badge form clicked through to the image, not
  the href; `[text](<url>)` produced no link; a link's `"title"` and a
  reference link's `[label]` leaked into the preview as text; the `:` of a
  `[a]: url` definition was hidden. Link parts are now read from the syntax
  tree rather than the source text, in both the inline and table-cell paths.
  (#25)
- A bare URL as a table cell's whole content rendered an empty cell, and
  `[www.a.com](https://b.com)` — link text that itself looks like a URL —
  vanished from the preview entirely. (#17)
- The checklist button on an empty `- [ ]` at the end of a line inserted a
  second checkbox instead of ticking the first. (#14)
- `![alt](url)` on the first line titled the chat document `!alt`. (#14)
- A corrupt or hostile batch on the channel could abort the process while
  decoding, and since the log replays on every launch, the document became
  permanently unopenable on every peer's device. A batch that killed the
  previous run is now recognised on the next start and quarantined. A batch
  that merely throws is contained instead, so one bad listener can no longer
  end the replay or silently drop that peer's later edits. (#18)
- A truncated history batch threw on every render of the history view, and a
  history error could swallow a document update before it reached the
  provider — stopping sync until restart. Malformed realtime frames from the
  ephemeral channel are dropped instead of escaping the decoder. (#14, #18)
- The on-device crash-safety draft failed silently once `localStorage` was
  full or blocked (Firefox with cookies disabled, a third-party-blocked
  iframe) — and a blocked `getItem` stopped the editor from starting at all.
  Every storage access is guarded, and a failed save shows "no device backup"
  in the status line instead of "saved". (#26)

### Changed
- 31 edge-case tests pinning the fixes above and neighbouring behaviour that
  was already correct. (#16)

## [0.3.0] - 2026-09-16

### Added
- Right-to-left text. Each line is laid out in the direction of its own first
  strong character, so an Arabic or Hebrew paragraph reads from the right while
  an English one beside it stays on the left, and a note may mix the two freely.
  Because the direction is known per line rather than assumed for the whole
  editor, the caret and click-to-position follow the visual order in mixed text
  instead of the logical one. Applies to the editor and to the rendered mode of
  the history viewer.
  - The direction comes from the document text, so revealing a line's markdown
    markers by putting the cursor on it cannot turn that line around, and
    neither can ticking a task in an Arabic list — block syntax is not content.
  - A line with no letters of its own takes the direction of the quote or list
    it sits in, so a `>` between two paragraphs, or an item you have just
    opened with Enter, does not start at the far side and jump across on the
    first keystroke.
  - Code and tables read one way throughout: fenced and indented code stay
    left-to-right whatever they contain, and a table follows its header, or a
    single Arabic row would reverse its pipes and slide its cells under the
    wrong columns.
  - A blockquote's bar takes the quote's direction rather than each line's, so
    it stays on one side even where the quote holds an English sentence among
    Arabic ones, or a code block, which is always left-to-right.
  - A selection spanning several lines is still drawn in the editor's own
    direction — CodeMirror reads one direction for that.
- Tables render. A markdown table is drawn as a table while the cursor is
  elsewhere and turns back into its source as soon as the selection touches it,
  the same way the inline markers reveal themselves. Columns line up on their
  own, so the pipes no longer have to be padded by hand to stay readable, and
  `:---`, `:---:` and `---:` set the column's alignment. Cell contents keep the
  formatting the rest of the editor paints — bold, italic, inline code,
  strikethrough — and a link in a cell is a link rather than its source. The
  table carries its own text direction, so an Arabic table is placed at the
  right and reads from there, with its columns and alignment mirrored. Screen readers are handed a real table instead
  of a row of pipes.
- Live-preview decorations now take their side from the text rather than from
  the page: the blockquote bar, the bullet's gap and the task checkbox's gap
  use the logical sides (`border-inline-start`, `padding-inline-start`,
  `margin-inline-end`), so on a right-to-left line each of them sits on the
  side of the words it belongs to. Two stay physical on purpose: the copy
  button, which sits on a fence line and fenced code is always laid out
  left-to-right, and the checkmark inside a checkbox, which is centred and is
  not a glyph that mirrors. A collaborator's name flag mirrors with the line
  too — on a right-to-left line it used to hang off the far edge, panning the
  editor sideways by the width of the name.

## [0.2.0] - 2026-09-16

### Added
- Separator lines: three or more minuses on their own line (`---`,
  `----------`, spaced `- - -`) now render as a horizontal rule, with the raw
  markers revealed again when the cursor is on the line. Near-misses stay plain
  text: two minuses, markers with trailing text, minuses mid-line, `---` under
  a paragraph (that is a setext heading), anything inside a fenced code block,
  and the `***` / `___` breaks CommonMark also allows.
- Syntax highlighting inside fenced code blocks for javascript, json,
  typescript, python, c, c++, java, c#, kotlin, scala, dart, objective-c,
  shell, rust, go, yaml and toml (plus the usual aliases: `js`, `ts`, `py`,
  `cs`, `kt`, `bash`, `rs`, `yml`, …). Unlisted languages stay plain text.
  Token colours are theme-aware in light and dark. The block's outer corners
  are rounded, and the fence's language reads as a quiet label rather than
  as the block's first line of content.
- A **Copy** button on every fenced code block, copying the block body without
  the ``` fences.
- `.github/workflows/preview.yml`: every pull request gets a sticky comment
  linking the built `.xdc` and reporting how much the bundle grew or shrank
  against the base branch.

### Fixed
- A list item holding a quote (`- > text`) rendered as both at once: the line
  carried the blockquote bar *and* the bullet. The shape is valid CommonMark — a
  list item directly containing a blockquote — so the quote styling now stands
  down when the quote is a list item's own content, and the line reads as the
  plain list item it is.
- Selecting text in a code block showed no highlight: the code background was
  opaque and CodeMirror paints the selection in a layer *behind* the content,
  so the fenced-block and inline-code backgrounds covered it. Selections that
  spanned a code block appeared to stop at its edge. The code background is now
  translucent (same rendered colour over the page background), so the selection
  shows through in fenced blocks, inline code, and mixed selections alike.

## [0.1.11] - 2026-07-20

### Fixed
- The "updated the document" chat notification fired when a peer merely opened
  the app, not only on real edits. Two paths fed the sync queue with non-edits:
  the `localStorage` draft was restored *before* the channel replay (so the
  whole document looked like a fresh local edit on every open), and incoming
  realtime frames were applied so that each receiver re-published a peer's edits
  under its own name. The draft restore now waits for the replay to finish, and
  realtime frames carry the provider's "not a local edit" marker — so the
  notification fires exactly once per session, only on a genuine edit.

## [0.1.10] - 2026-07-15

### Fixed
- Bare and autolinked URLs (`https://…`, `www.…`, `<https://…>`) were hidden in
  the live preview: the decoration builder blanket-hid every `URL` node, which
  is only correct for the destination inside `[text](url)` / `![alt](url)`. A
  standalone autolink is itself the visible link, so it now renders as a styled,
  clickable link (bare `www.` links get an `https://` scheme).

## [0.1.9] - 2026-06-29

### Fixed
- Edits are persisted to `localStorage`, so an abrupt iOS app exit no longer
  loses unsaved work.

## [0.1.8] - 2026-06-28

### Fixed
- Restoring a past version used `window.confirm`, which is unreliable in the iOS
  webxdc runtime. Replaced with an in-app confirmation dialog.

## [0.1.7] - 2026-06-28

### Fixed
- Making a heading on a blank line now parks the cursor after the marker instead
  of before it.

## [0.1.6] - 2026-06-28

### Fixed
- Mobile status line overlaid the toolbar (a CSS source-order bug).
- Task checkboxes were too small to tap comfortably; enlarged them, more so on
  touch devices.

## [0.1.5] - 2026-06-28

### Added
- Bullet button converts a checkbox list item back into a plain bullet.

### Changed
- Mobile status line is laid out as a row above the toolbar rather than an
  overlay.
- Chat summary reads "updated the document" with the last-edit time.

### Fixed
- List continuation on Enter no longer inserts blank lines (loose lists).

## [0.1.4] - 2026-06-28

### Fixed
- iOS keyboard no longer hides the mobile toolbar: `#app` is sized to the visual
  viewport.

## [0.1.3] - 2026-06-28

### Fixed
- Realtime sync could crash (`RangeError`) on large documents: the frame builder
  spread the update body into `Uint8Array.of(...)`, overflowing the argument-count
  limit during a full-state catch-up. Build the frame with allocate-and-set.

## [0.1.2] - 2026-06-28

### Fixed
- Crash on launch in the real Delta Chat client (`TypeError: 'get' on proxy …`):
  the webxdc history shim wrapped the native `webxdc` object in a `Proxy`, which
  is illegal over its read-only, non-configurable methods. Replaced with a plain
  delegating object.

## [0.1.1] - 2026-06-28

### Fixed
- Document history is now mentioned in the in-app help overlay.

## [0.1.0] - 2026-06-28

First release.

### Added
- Collaborative Obsidian-style markdown editor for webxdc, built on CodeMirror
  6 with real-time sync over Yjs (`y-webxdc`).
- Live-preview markdown: inline reveal of formatting markers, heading styles,
  bold/italic/code, blockquotes, links, bullet and task lists.
- Formatting toolbar (bold, italic, inline code, headings, bullets, checklists)
  with light/dark theme toggle and a help overlay.
- Scrollable document history timeline reconstructing past versions.
- App icon.
