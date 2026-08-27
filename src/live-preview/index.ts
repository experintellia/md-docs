import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { type Extension } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import { linkClickHandler, livePreviewPlugin } from './decorations.ts';

// Highlight style for fenced-code-block contents (and other tagged tokens).
// Colours come from CSS custom properties so the one style serves both themes
// (see `--tok-*` in css/live-preview.css) — CodeMirror only toggles classes,
// it has no idea `html.dark` is on.
const mdHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--tok-keyword)' },
  { tag: [tags.controlKeyword, tags.moduleKeyword], color: 'var(--tok-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--tok-string)' },
  { tag: tags.comment, color: 'var(--tok-comment)', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.atom], color: 'var(--tok-number)' },
  { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: 'var(--tok-function)' },
  { tag: tags.macroName, color: 'var(--tok-function)' },
  { tag: [tags.typeName, tags.className, tags.standard(tags.variableName)], color: 'var(--tok-type)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--tok-property)' },
  { tag: tags.tagName, color: 'var(--tok-type)' },
  // `meta` is both a preprocessor/shebang line and the ``` fence itself (shown
  // when the cursor is on that line) — muted keeps the revealed fence quiet.
  { tag: tags.meta, color: 'var(--tok-meta)' },
  { tag: tags.operator, color: 'var(--tok-operator)' },
  { tag: tags.invalid, color: 'var(--tok-invalid)' },
]);

/**
 * Our clean-room Obsidian-style live-preview layer. Compose this into the
 * editor to render markdown formatting inline while keeping the source text.
 */
export function livePreview(): Extension {
  return [livePreviewPlugin, linkClickHandler, syntaxHighlighting(mdHighlight)];
}
