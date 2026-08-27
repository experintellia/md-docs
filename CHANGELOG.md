# Changelog

All notable changes to MD-Docs are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Separator lines: three or more minuses on their own line (`---`,
  `----------`, spaced `- - -`) now render as a horizontal rule, with the raw
  markers revealed again when the cursor is on the line. Near-misses stay plain
  text: two minuses, markers with trailing text, minuses mid-line, `---` under
  a paragraph (that is a setext heading), anything inside a fenced code block,
  and the `***` / `___` breaks CommonMark also allows.

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
