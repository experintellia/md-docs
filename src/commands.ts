import type { Command, KeyBinding } from '@codemirror/view';

/** Toggle an inline wrapper (e.g. `**` for bold) around each selection range. */
function toggleWrap(marker: string): Command {
  return (view) => {
    const { state } = view;
    const changes: { from: number; to: number; insert: string }[] = [];
    for (const range of state.selection.ranges) {
      const before = state.sliceDoc(range.from - marker.length, range.from);
      const after = state.sliceDoc(range.to, range.to + marker.length);
      if (before === marker && after === marker) {
        changes.push({ from: range.from - marker.length, to: range.from, insert: '' });
        changes.push({ from: range.to, to: range.to + marker.length, insert: '' });
      } else {
        changes.push({ from: range.from, to: range.from, insert: marker });
        changes.push({ from: range.to, to: range.to, insert: marker });
      }
    }
    if (!changes.length) return false;
    view.dispatch({ changes });
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
    view.dispatch({ changes: { from: pos, to: pos, insert: '[ ] ' } });
    return true;
  }

  const indent = /^(\s*)/.exec(text)![1];
  const pos = line.from + indent.length;
  view.dispatch({ changes: { from: pos, to: pos, insert: '- [ ] ' } });
  return true;
};

/** Keyboard shortcuts (desktop) mirroring the toolbar actions. */
export const markdownKeymap: KeyBinding[] = [
  { key: 'Mod-b', run: toggleBold },
  { key: 'Mod-i', run: toggleItalic },
  { key: 'Mod-e', run: toggleInlineCode },
  { key: 'Mod-Shift-h', run: cycleHeading },
  { key: 'Mod-Shift-c', run: toggleChecklist },
];
