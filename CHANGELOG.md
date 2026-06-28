# Changelog

All notable changes to MD-Docs are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
