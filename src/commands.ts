import { EditorSelection } from '@codemirror/state';
import type { Command, KeyBinding } from '@codemirror/view';

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
 * Toggle a bullet on the current line: a plain line gets "- " (after any
 * indentation); an existing bullet is removed.
 *
 * ponytail: a task item counts as a bullet, so toggling off "- [ ] x" leaves
 * "[ ] x". Edge case, not worth special-casing for v1.
 */
export const toggleBullet: Command = (view) => {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const bullet = /^(\s*)([-*+] )/.exec(line.text);
  if (bullet) {
    const from = line.from + bullet[1].length;
    view.dispatch({ changes: { from, to: from + bullet[2].length, insert: '' } });
    return true;
  }
  const indent = /^(\s*)/.exec(line.text)![1];
  const pos = line.from + indent.length;
  view.dispatch({
    changes: { from: pos, to: pos, insert: '- ' },
    selection: { anchor: pos + 2 },
  });
  return true;
};

/** Keyboard shortcuts (desktop) mirroring the toolbar actions. */
export const markdownKeymap: KeyBinding[] = [
  { key: 'Mod-b', run: toggleBold },
  { key: 'Mod-i', run: toggleItalic },
  { key: 'Mod-e', run: toggleInlineCode },
  { key: 'Mod-Shift-h', run: cycleHeading },
  { key: 'Mod-Shift-8', run: toggleBullet },
  { key: 'Mod-Shift-c', run: toggleChecklist },
];
