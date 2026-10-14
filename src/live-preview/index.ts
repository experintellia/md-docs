import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorSelection, type Extension, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { linkClickHandler, livePreviewPlugin, mathField, tableField } from './decorations.ts';

// Highlight style for fenced-code-block contents (and other tagged tokens).
// Colours come from CSS custom properties so the one style serves both themes
// (see `--tok-*` in css/main.css) — CodeMirror only toggles classes,
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
  // The fence's info string (the `js` in ```js) labels the block rather than
  // being part of it — quiet it down to match the Copy button on the same line.
  { tag: tags.labelName, color: 'var(--tok-meta)', fontSize: '0.85em' },
  { tag: tags.operator, color: 'var(--tok-operator)' },
  { tag: tags.invalid, color: 'var(--tok-invalid)' },
]);

// CodeMirror moves vertically by the drawn lines, and a rendered table or `$$`
// block is one tall widget it steps right over: its source could only be
// reached with the horizontal arrows. Stop on the block's near edge instead,
// which reveals its source as the horizontal arrows already do.
function intoBlock(forward: boolean) {
  return (view: EditorView): boolean => {
    const sel = view.state.selection.main;
    if (!sel.empty) return false;
    const moved = view.moveVertically(sel, forward);
    const lo = Math.min(sel.head, moved.head);
    const hi = Math.max(sel.head, moved.head);
    let target = -1;
    for (const field of [mathField, tableField]) {
      view.state.field(field).between(lo, hi, (from, to, deco) => {
        if (!deco.spec.block) return;
        // The edge the caret meets first must lie past it and within the
        // move. The far edge may end the move: a block at the document's end,
        // or after the `> ` of a quote, which motion would otherwise cross.
        const edge = forward ? from : to;
        if (forward ? edge <= sel.head || edge > moved.head : edge >= sel.head || edge < moved.head) return;
        if (target < 0 || (forward ? edge < target : edge > target)) target = edge;
      });
    }
    if (target < 0) return false;
    // Keep the goal column, so the next press carries on in the column the
    // caret came from. A bare range spec would drop it.
    const cursor = EditorSelection.cursor(target, forward ? 1 : -1, undefined, moved.goalColumn);
    view.dispatch({ selection: EditorSelection.create([cursor]), scrollIntoView: true });
    return true;
  };
}

/**
 * Our clean-room Obsidian-style live-preview layer. Compose this into the
 * editor to render markdown formatting inline while keeping the source text.
 */
export function livePreview(): Extension {
  return [
    Prec.high(keymap.of([{ key: 'ArrowUp', run: intoBlock(false) }, { key: 'ArrowDown', run: intoBlock(true) }])),
    // The widget fields first, so a link's mark wraps the math inside it and a
    // tap on the formula can follow the link.
    tableField,
    mathField,
    livePreviewPlugin,
    linkClickHandler,
    syntaxHighlighting(mdHighlight),
    // Read each line's own direction instead of assuming one for the whole
    // editor. This is what makes the `dir` the plugin puts on every line count
    // for caret motion, selection drawing and click-to-position — CM6 measures
    // direction per line only when this facet is on. It lives here rather than
    // in editor.ts so it travels with the decorations that need it: the history
    // viewer swaps this whole extension in and out per view mode.
    EditorView.perLineTextDirection.of(true),
  ];
}
