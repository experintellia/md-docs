import { EditorSelection } from '@codemirror/state';
import type { Command, KeyBinding } from '@codemirror/view';
import { insertNewlineContinueMarkupCommand, deleteMarkupBackward } from '@codemirror/lang-markdown';

/**
 * Toggle an inline wrapper (e.g. `**` for bold) around each selection range.
 * Uses changeByRange so the selection follows the edit: a collapsed cursor
 * lands between the markers (`**|**`), a selection stays wrapped on the text.
 */
function toggleWrap(marker: string): Command {
  return (view) => {
    const m = marker.length;
    const tr = view.state.changeByRange((range) => {
      const wrapped =
        view.state.sliceDoc(range.from - m, range.from) === marker &&
        view.state.sliceDoc(range.to, range.to + m) === marker;
      return wrapped
        ? {
          changes: [
            { from: range.from - m, to: range.from },
            { from: range.to, to: range.to + m },
          ],
          range: EditorSelection.range(range.from - m, range.to - m),
        }
        : {
          changes: [
            { from: range.from, insert: marker },
            { from: range.to, insert: marker },
          ],
          range: EditorSelection.range(range.from + m, range.to + m),
        };
    });
    view.dispatch(view.state.update(tr, { scrollIntoView: true }));
    return true;
  };
}

export const toggleBold = toggleWrap('**');
export const toggleItalic = toggleWrap('*');
export const toggleInlineCode = toggleWrap('`');

/** Cycle the current line's heading level: none -> H1 -> H2 -> H3 -> none. */
export const cycleHeading: Command = (view) => {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const m = /^(#{1,6})\s/.exec(line.text);
  const current = m ? m[1].length : 0;
  const next = current >= 3 ? 0 : current + 1;
  const removeLen = m ? m[0].length : 0;
  const prefix = next === 0 ? '' : '#'.repeat(next) + ' ';
  view.dispatch({
    changes: { from: line.from, to: line.from + removeLen, insert: prefix },
    // On an empty line the cursor sits at the insertion point and CM would leave
    // it before the inserted "# "; park it after the marker to type the heading.
    // A non-empty line maps the cursor through the change correctly on its own.
    ...(line.length === 0 ? { selection: { anchor: line.from + prefix.length } } : {}),
  });
  return true;
};

/**
 * Toggle a task checklist on the current line:
 *  - task item    -> flip [ ] <-> [x]
 *  - bullet item  -> insert "[ ] " after the marker
 *  - anything else -> prepend "- [ ] " (keeping indentation)
 */
export const toggleChecklist: Command = (view) => {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const text = line.text;

  const task = /^(\s*[-*+] )\[([ xX])\] /.exec(text);
  if (task) {
    const checked = task[2] !== ' ';
    const stateCharPos = line.from + task[1].length + 1; // char inside the [ ]
    view.dispatch({
      changes: { from: stateCharPos, to: stateCharPos + 1, insert: checked ? ' ' : 'x' },
    });
    return true;
  }

  const bullet = /^(\s*[-*+] )/.exec(text);
  if (bullet) {
    const pos = line.from + bullet[1].length;
    const insert = '[ ] ';
    // Explicit selection: keep the cursor after the inserted marker, not in
    // front of it (CM's default left-association would strand it before [ ]).
    view.dispatch({
      changes: { from: pos, to: pos, insert },
      selection: { anchor: pos + insert.length },
    });
    return true;
  }

  const indent = /^(\s*)/.exec(text)![1];
  const pos = line.from + indent.length;
  const insert = '- [ ] ';
  view.dispatch({
    changes: { from: pos, to: pos, insert },
    selection: { anchor: pos + insert.length },
  });
  return true;
};

/**
 * Toggle a bullet on the current line:
 *  - task item   -> plain bullet (strip the "[ ] " checkbox, keep the marker)
 *  - bullet item -> remove the marker
 *  - anything else -> prepend "- " (keeping indentation)
 *
 * The task case makes the bullet button the inverse of the checklist button:
 * checklist turns a bullet into a task, bullet turns a task back into a bullet.
 */
export const toggleBullet: Command = (view) => {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const text = line.text;

  // Task item: drop only the "[ ] " checkbox, leaving a plain bullet.
  const task = /^(\s*[-*+] )(\[[ xX]\] )/.exec(text);
  if (task) {
    const from = line.from + task[1].length;
    view.dispatch({ changes: { from, to: from + task[2].length, insert: '' } });
    return true;
  }

  const bullet = /^(\s*)([-*+] )/.exec(text);
  if (bullet) {
    const from = line.from + bullet[1].length;
    view.dispatch({ changes: { from, to: from + bullet[2].length, insert: '' } });
    return true;
  }
  const indent = /^(\s*)/.exec(text)![1];
  const pos = line.from + indent.length;
  view.dispatch({
    changes: { from: pos, to: pos, insert: '- ' },
    selection: { anchor: pos + 2 },
  });
  return true;
};

/** Keyboard shortcuts mirroring the toolbar actions, plus markdown-aware
 *  Enter/Backspace. We bind Enter ourselves (lang-markdown's keymap is disabled
 *  via addKeymap:false in editor.ts) with `nonTightLists: false` so a double
 *  Enter on an empty list item *exits* the list instead of inserting a blank
 *  line and turning the list "loose" — which otherwise compounds a blank line
 *  before every subsequent item. Both commands return false outside markdown
 *  markup, so the defaultKeymap fallbacks (newline / delete) still apply. */
export const markdownKeymap: KeyBinding[] = [
  { key: 'Enter', run: insertNewlineContinueMarkupCommand({ nonTightLists: false }) },
  { key: 'Backspace', run: deleteMarkupBackward },
  { key: 'Mod-b', run: toggleBold },
  { key: 'Mod-i', run: toggleItalic },
  { key: 'Mod-e', run: toggleInlineCode },
  { key: 'Mod-Shift-h', run: cycleHeading },
  { key: 'Mod-Shift-8', run: toggleBullet },
  { key: 'Mod-Shift-c', run: toggleChecklist },
];
