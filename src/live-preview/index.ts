import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { type Extension } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import { linkClickHandler, livePreviewPlugin } from './decorations.ts';

// Highlight style for fenced-code-block contents (and other tagged tokens).
const mdHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#cf222e' },
  { tag: tags.string, color: '#0a3069' },
  { tag: tags.comment, color: '#6e7781', fontStyle: 'italic' },
  { tag: tags.number, color: '#0550ae' },
  { tag: tags.function(tags.variableName), color: '#8250df' },
]);

/**
 * Our clean-room Obsidian-style live-preview layer. Compose this into the
 * editor to render markdown formatting inline while keeping the source text.
 */
export function livePreview(): Extension {
  return [livePreviewPlugin, linkClickHandler, syntaxHighlighting(mdHighlight)];
}
