# Changelog

All notable changes to MD-Docs are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
