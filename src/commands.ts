import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type SelectionRange,
  type Transaction,
} from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import type { Command, KeyBinding } from '@codemirror/view';
import { insertNewlineContinueMarkupCommand, deleteMarkupBackward } from '@codemirror/lang-markdown';

type RangeChange = { changes: ChangeSpec; range: SelectionRange };
interface Span { from: number; to: number }

/**
 * Toggle a wrapper by looking only at the text right around the range: unwrap
 * if the markers sit directly outside it, wrap otherwise. A collapsed cursor
 * lands between the markers (`**|**`), a selection stays on the text.
 */
function wrapRange(state: EditorState, range: SelectionRange, marker: string): RangeChange {
  const m = marker.length;
  const wrapped =
    state.sliceDoc(range.from - m, range.from) === marker &&
    state.sliceDoc(range.to, range.to + m) === marker;
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
}

function command(change: (state: EditorState, range: SelectionRange) => RangeChange): Command {
  return (view) => {
    const tr = view.state.changeByRange((range) => change(view.state, range));
    view.dispatch(view.state.update(tr, { scrollIntoView: true }));
    return true;
  };
}

/** The syntax node each style's marker produces. */
const STYLES: Record<string, string> = { '**': 'StrongEmphasis', '*': 'Emphasis', '~~': 'Strikethrough' };
const STYLE_NODES = new Set(Object.values(STYLES));
/** Inline nodes a marker must not land inside: a selection edge in one of
 *  these moves out to its border. */
const ATOMS = new Set(['InlineCode', 'InlineMath', 'DisplayMath', 'URL', 'Autolink', 'HTMLTag', 'Image']);
/** What a styled run cannot cross: block markup and blocks that hold no
 *  markdown. Line breaks are added to these. */
const BREAKS = new Set([
  'ListMark', 'QuoteMark', 'HeaderMark', 'TaskMarker', 'TableDelimiter', 'HorizontalRule',
  'FencedCode', 'CodeBlock', 'MathBlock', 'HTMLBlock', 'CommentBlock', 'LinkReference',
]);

const within = (spans: readonly Span[], pos: number): boolean => spans.some((s) => s.from <= pos && pos < s.to);
const minus = (spans: readonly Span[], cut: Span): Span[] =>
  spans.flatMap((s) => [
    { from: s.from, to: Math.min(s.to, cut.from) },
    { from: Math.max(s.from, cut.to), to: s.to },
  ].filter((p) => p.from < p.to));

/**
 * Toggle bold, italic or strikethrough on a selection as a set operation on
 * the styled text: if everything selected already has the style, the selection
 * is cut out of it (`**a «b» c**` -> `**a** b **c**`); otherwise the selection
 * is added to it, joining the styled text it touches (`**a «b** c»` ->
 * `**a b c**`). Each line gets its own markers, inside its list, quote or
 * heading markup and tight around the words, as markdown requires.
 *
 * Works on the syntax tree: the markers of the style's nodes around the
 * selection are removed and new ones set at the borders of the resulting runs.
 */
function styleRange(state: EditorState, range: SelectionRange, marker: string): RangeChange {
  if (range.empty) return wrapRange(state, range, marker);
  const type = STYLES[marker];
  const tree = ensureSyntaxTree(state, state.doc.lineAt(range.to).to, 500) ?? syntaxTree(state);
  const at = (pos: number): string => state.sliceDoc(pos, pos + 1);

  // Move a selection edge out of a node no marker may split. A link counts,
  // unless the whole selection is inside its text.
  const inLinkText = (link: SyntaxNode): boolean => {
    const marks = link.getChildren('LinkMark');
    return marks.length >= 2 && range.from >= marks[0].to && range.to <= marks[1].from;
  };
  const atom = (pos: number): SyntaxNode | null => {
    let found: SyntaxNode | null = null;
    for (let n: SyntaxNode | null = tree.resolve(pos, 0); n; n = n.parent) {
      if (n.from < pos && pos < n.to && (ATOMS.has(n.name) || (n.name === 'Link' && !inLinkText(n)))) found = n;
    }
    return found;
  };
  const from = atom(range.from)?.from ?? range.from;
  const to = atom(range.to)?.to ?? range.to;

  // The style's nodes on or next to the selection (spaces don't separate):
  // their markers go, their text is what is styled now.
  let lookFrom = from;
  let lookTo = to;
  while (/[ \t]/.test(at(lookFrom - 1)) && lookFrom > 0) lookFrom--;
  while (/[ \t]/.test(at(lookTo))) lookTo++;
  let styled: Span[] = [];
  const old: Span[] = [];
  tree.iterate({
    from: lookFrom,
    to: lookTo,
    enter: (n) => {
      if (n.name !== type) return;
      const open = n.node.firstChild;
      const close = n.node.lastChild;
      if (!open || !close || open.from === close.from) return;
      styled.push({ from: open.to, to: close.from });
      old.push({ from: open.from, to: open.to }, { from: close.from, to: close.to });
    },
  });
  const lo = Math.min(from, ...old.map((s) => s.from));
  const hi = Math.max(to, ...old.map((s) => s.to));

  const breaks: Span[] = [];
  const marks: Span[] = [];
  const others: (Span & { inner: Span })[] = []; // the other styles' nodes
  tree.iterate({
    from: lo,
    to: hi,
    enter: (n) => {
      if (BREAKS.has(n.name)) {
        breaks.push({ from: n.from, to: n.to });
        return false;
      }
      if (n.name.endsWith('Mark')) marks.push({ from: n.from, to: n.to });
      if (STYLE_NODES.has(n.name) && n.name !== type) {
        const open = n.node.firstChild;
        const close = n.node.lastChild;
        if (open && close) others.push({ from: n.from, to: n.to, inner: { from: open.to, to: close.from } });
      }
      return undefined;
    },
  });
  for (let pos = lo; pos < hi; pos++) if (at(pos) === '\n') breaks.push({ from: pos, to: pos + 1 });

  // ponytail: per-character scans against span lists, fine for a selection of
  // a few thousand characters; index the spans if select-all + bold gets slow.
  const isText = (pos: number): boolean => /\S/.test(at(pos)) && !within(marks, pos) && !within(breaks, pos);
  let any = false;
  let all = true;
  for (let pos = from; pos < to; pos++) {
    if (!isText(pos)) continue;
    any = true;
    if (!within(styled, pos)) all = false;
  }
  if (!any) return { changes: [], range };

  // Whitespace and the markers being removed: runs join across these and don't
  // start or end on them.
  const blank = (pos: number): boolean => /\s/.test(at(pos)) || within(old, pos);
  const add = !all;
  if (add) {
    styled.push({ from, to });
    styled.sort((a, b) => a.from - b.from);
    const joined: Span[] = [];
    for (const s of styled) {
      const last = joined[joined.length - 1];
      let gap = !!last;
      for (let pos = last?.to ?? 0; gap && pos < s.from; pos++) if (!blank(pos)) gap = false;
      if (last && gap) last.to = Math.max(last.to, s.to);
      else joined.push({ ...s });
    }
    styled = joined;
  } else {
    styled = minus(styled, { from, to });
  }
  for (const cut of breaks) styled = minus(styled, cut);
  // A run that crosses the edge of another style's node would not nest: split
  // it into the part inside that node and the part outside.
  for (let split = true; split;) {
    split = false;
    styled = styled.flatMap((s) => {
      const o = others.find((c) => s.from < c.to && c.from < s.to
        && !(s.from <= c.from && c.to <= s.to) && !(c.inner.from <= s.from && s.to <= c.inner.to));
      if (!o) return [s];
      split = true;
      return [...minus([s], o), { from: Math.max(s.from, o.inner.from), to: Math.min(s.to, o.inner.to) }]
        .filter((p) => p.from < p.to);
    });
  }
  styled = styled.map(({ from: f, to: t }) => {
    while (f < t && blank(f)) f++;
    while (f < t && blank(t - 1)) t--;
    return { from: f, to: t };
  }).filter((s) => s.from < s.to);

  // A marker that is already where one is needed stays, so an unchanged run
  // produces no edit (and nothing for a peer's cursor to trip over).
  const changes: ChangeSpec[] = [];
  const keep = new Set<Span>();
  const place = (pos: number, existing: Span | undefined): void => {
    if (existing && state.sliceDoc(existing.from, existing.to) === marker) keep.add(existing);
    else changes.push({ from: pos, insert: marker });
  };
  for (const s of styled) {
    place(s.from, old.find((o) => o.to === s.from && !keep.has(o)));
    place(s.to, old.find((o) => o.from === s.to && !keep.has(o)));
  }
  for (const o of old) if (!keep.has(o)) changes.push(o);

  // The selection stays on the text, inside markers set at its edges.
  const mapped = state.changes(changes);
  const a = mapped.mapPos(range.from, 1);
  const b = Math.max(a, mapped.mapPos(range.to, -1));
  return { changes: mapped, range: range.anchor <= range.head ? EditorSelection.range(a, b) : EditorSelection.range(b, a) };
}

export const toggleBold = command((state, range) => styleRange(state, range, '**'));
export const toggleItalic = command((state, range) => styleRange(state, range, '*'));
export const toggleStrikethrough = command((state, range) => styleRange(state, range, '~~'));
export const toggleInlineCode = command((state, range) => wrapRange(state, range, '`'));

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

  // `(?=[ \t]|$)`, not a literal space: an empty task item sits at the end of
  // the line (`- [ ]`) with no trailing space, and matching only the spaced
  // form made this insert a second checkbox instead of ticking the first.
  // A tab after the box is a task item per GFM too.
  const task = /^(\s*[-*+] )\[([ xX])\](?=[ \t]|$)/.exec(text);
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
  const task = /^(\s*[-*+] )(\[[ xX]\](?:[ \t]|$))/.exec(text);
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

const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });

const MARKUP = new Set(['ListMark', 'QuoteMark', 'TaskMarker']);

/** Whether [from, to) holds nothing but whitespace and list/quote/task markup. */
function onlyMarkup(state: EditorState, from: number, to: number): boolean {
  const tree = syntaxTree(state);
  for (let pos = from; pos < to; pos++) {
    if (/\S/.test(state.sliceDoc(pos, pos + 1)) && !MARKUP.has(tree.resolveInner(pos, 1).name)) return false;
  }
  return true;
}

/** lang-markdown's Enter, minus a bug (seen in 6.5.0 through 6.5.2): it judges
 *  an item "empty" by slicing the caret's line at the column where the item's
 *  *first* line's markup ends. On a continuation line whose text ends before
 *  that column (`- [ ] \n 2,5h|`) the slice is blank, so Enter "exits the empty
 *  item" and deletes the line's text. Enter may only delete whitespace and
 *  markup; if upstream would delete anything else, decline, and the
 *  defaultKeymap's plain newline runs. */
export const insertNewlineContinueMarkup: Command = (view) => {
  const { state } = view;
  let tr: Transaction | undefined;
  if (!continueMarkup({ state, dispatch: (t) => { tr = t; } }) || !tr) return false;
  let safe = true;
  tr.changes.iterChanges((fromA, toA) => {
    if (!onlyMarkup(state, fromA, toA)) safe = false;
  });
  if (!safe) return false;
  view.dispatch(tr);
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
  { key: 'Enter', run: insertNewlineContinueMarkup },
  { key: 'Backspace', run: deleteMarkupBackward },
  { key: 'Mod-b', run: toggleBold },
  { key: 'Mod-i', run: toggleItalic },
  { key: 'Mod-Shift-x', run: toggleStrikethrough },
  { key: 'Mod-e', run: toggleInlineCode },
  { key: 'Mod-Shift-h', run: cycleHeading },
  { key: 'Mod-Shift-8', run: toggleBullet },
  { key: 'Mod-Shift-c', run: toggleChecklist },
];
