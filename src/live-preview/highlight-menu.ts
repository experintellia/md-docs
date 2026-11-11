import { syntaxTree } from '@codemirror/language';
import { type EditorState, StateField } from '@codemirror/state';
import { type EditorView, showTooltip, type Tooltip } from '@codemirror/view';
import { HIGHLIGHT_COLORS } from './highlight.ts';

// Where `==` is no markup.
const NOT_PROSE = /Code|Math|HTML|Comment/;

/**
 * Where the color menu shows: at the caret, when it sits right after the
 * opening `==` of a highlight and no color emoji follows yet, else null.
 *
 * A `==` just typed is no highlight yet, as nothing closes it, so it is taken
 * for an opening one where it could open one: after a space, the start of the
 * line or punctuation. A closing `==`, one in a `===` run, an escaped one, and
 * one in code or math open nothing.
 */
export function colorMenuAt(state: EditorState): number | null {
  const sel = state.selection;
  if (state.readOnly || sel.ranges.length > 1 || !sel.main.empty) return null;
  const head = sel.main.head;
  const doc = state.doc;
  if (doc.sliceString(head - 2, head) !== '==') return null;
  const before = doc.sliceString(head - 3, head - 2);
  if (before === '=' || before === '\\') return null;
  const after = doc.sliceString(head, head + 3);
  // `==|==`, an empty highlight (what the toolbar button inserts), is the one
  // `=` that may follow: not `==|=`, a `===` run.
  if (HIGHLIGHT_COLORS[after.slice(0, 2)] || (after.startsWith('=') && !/^==(?!=)/.test(after))) return null;
  for (let n: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(state).resolveInner(head, -1); n; n = n.parent) {
    if (NOT_PROSE.test(n.name)) return null;
    if (n.name === 'HighlightMark') return n.parent && n.from === n.parent.from ? head : null;
  }
  return before === '' || /[\s\p{P}\p{S}]/u.test(before) ? head : null;
}

function menu(view: EditorView): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'md-hl-menu';
  dom.setAttribute('role', 'toolbar');
  dom.setAttribute('aria-label', 'Highlight color');
  for (const [emoji, color] of Object.entries(HIGHLIGHT_COLORS)) {
    const btn = dom.appendChild(document.createElement('button'));
    btn.type = 'button';
    btn.textContent = emoji;
    btn.title = color;
    btn.setAttribute('aria-label', `${color} highlight`);
    // Keep the caret, and a phone's keyboard, in the editor.
    btn.addEventListener('mousedown', (event) => event.preventDefault());
    btn.addEventListener('click', () => {
      const at = colorMenuAt(view.state);
      if (at === null) return;
      view.dispatch({ changes: { from: at, insert: emoji }, selection: { anchor: at + emoji.length } });
      view.focus();
    });
  }
  return dom;
}

function tooltipAt(state: EditorState, current: Tooltip | null): Tooltip | null {
  const pos = colorMenuAt(state);
  if (pos === null) return null;
  // The same menu while the caret stays put, rather than a new one per update.
  if (current?.pos === pos) return current;
  return { pos, create: (view) => ({ dom: menu(view) }) };
}

/** The highlight color menu, as Obsidian suggests the colors after `==`. */
export const highlightMenu = StateField.define<Tooltip | null>({
  create: (state) => tooltipAt(state, null),
  update: (value, tr) => (
    tr.docChanged || tr.selection || tr.startState.readOnly !== tr.state.readOnly
      || syntaxTree(tr.state) !== syntaxTree(tr.startState)
      ? tooltipAt(tr.state, value)
      : value
  ),
  provide: (field) => showTooltip.from(field),
});
