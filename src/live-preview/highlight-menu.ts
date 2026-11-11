import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Extension, Prec, StateEffect, StateField } from '@codemirror/state';
import { EditorView, keymap, showTooltip, type Tooltip } from '@codemirror/view';
import { HIGHLIGHT_COLORS } from './highlight.ts';

// Where `==` is no markup.
const NOT_PROSE = /Code|Math|HTML|Comment/;

const COLORS = Object.entries(HIGHLIGHT_COLORS);

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

interface Menu {
  pos: number;
  /** The color the arrow keys are on, or null while typing goes to the text. */
  active: number | null;
  /** Closed with Escape, until the text or the caret moves on. */
  dismissed: boolean;
  tooltip: Tooltip;
}

const setActive = StateEffect.define<number | null>();
const dismiss = StateEffect.define<null>();

const optionId = (i: number): string => `md-hl-color-${i}`;

// Put the color in, after the `==`, and the caret after it.
function pick(view: EditorView, i: number): boolean {
  const at = colorMenuAt(view.state);
  const emoji = COLORS[i]?.[0];
  if (at === null || !emoji) return false;
  view.dispatch({ changes: { from: at, insert: emoji }, selection: { anchor: at + emoji.length } });
  view.focus();
  return true;
}

function menuDom(view: EditorView): { dom: HTMLElement; update: () => void } {
  // A listbox the caret stays out of: the arrow keys move its selection from
  // the editor, which points a screen reader at it with aria-activedescendant.
  const dom = document.createElement('div');
  dom.className = 'md-hl-menu';
  dom.setAttribute('role', 'listbox');
  dom.setAttribute('aria-label', 'Highlight color');
  dom.setAttribute('aria-orientation', 'horizontal');
  const buttons = COLORS.map(([emoji, color], i) => {
    const btn = dom.appendChild(document.createElement('button'));
    btn.type = 'button';
    btn.tabIndex = -1;
    btn.id = optionId(i);
    btn.textContent = emoji;
    btn.title = color;
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-label', `${color} highlight`);
    // Keep the caret, and a phone's keyboard, in the editor.
    btn.addEventListener('mousedown', (event) => event.preventDefault());
    btn.addEventListener('click', () => pick(view, i));
    return btn;
  });
  const update = (): void => {
    const active = view.state.field(menuField)?.active ?? null;
    buttons.forEach((btn, i) => {
      btn.setAttribute('aria-selected', String(i === active));
      btn.classList.toggle('md-hl-active', i === active);
    });
  };
  update();
  return { dom, update };
}

function fresh(pos: number): Menu {
  return { pos, active: null, dismissed: false, tooltip: { pos, create: (view) => menuDom(view) } };
}

const menuField = StateField.define<Menu | null>({
  create: (state) => {
    const pos = colorMenuAt(state);
    return pos === null ? null : fresh(pos);
  },
  update: (value, tr) => {
    if (tr.docChanged || tr.selection || tr.startState.readOnly !== tr.state.readOnly
      || syntaxTree(tr.state) !== syntaxTree(tr.startState)) {
      const pos = colorMenuAt(tr.state);
      if (pos === null) return null;
      // The same menu while the caret stays put, its arrow-key choice and an
      // Escape included, rather than a new one per update.
      value = !tr.docChanged && value?.pos === pos ? value : fresh(pos);
    }
    for (const effect of tr.effects) {
      if (!value) break;
      if (effect.is(setActive)) value = { ...value, active: effect.value };
      if (effect.is(dismiss)) value = { ...value, active: null, dismissed: true };
    }
    return value;
  },
  provide: (field) => [
    showTooltip.compute([field], (state) => {
      const menu = state.field(field);
      return menu && !menu.dismissed ? menu.tooltip : null;
    }),
    EditorView.contentAttributes.compute([field], (state): Record<string, string> => {
      const active = state.field(field)?.active ?? null;
      return active === null ? {} : { 'aria-activedescendant': optionId(active) };
    }),
  ],
});

// The menu as the keys see it: open, and where its selection is.
function open(view: EditorView): Menu | null {
  const menu = view.state.field(menuField);
  return menu && !menu.dismissed ? menu : null;
}

const move = (step: number) => (view: EditorView): boolean => {
  const active = open(view)?.active ?? null;
  if (active === null) return false;
  view.dispatch({ effects: setActive.of((active + step + COLORS.length) % COLORS.length) });
  return true;
};

const choose = (view: EditorView): boolean => {
  const active = open(view)?.active ?? null;
  return active !== null && pick(view, active);
};

// Until ArrowDown steps into the menu, every key goes to the text as usual:
// Enter after `==` still starts a new line.
const menuKeymap = Prec.highest(keymap.of([
  {
    key: 'ArrowDown',
    run: (view) => {
      const menu = open(view);
      if (!menu) return false;
      if (menu.active === null) view.dispatch({ effects: setActive.of(0) });
      return true;
    },
  },
  {
    key: 'ArrowUp',
    run: (view) => {
      if ((open(view)?.active ?? null) === null) return false;
      view.dispatch({ effects: setActive.of(null) });
      return true;
    },
  },
  { key: 'ArrowRight', run: move(1) },
  { key: 'ArrowLeft', run: move(-1) },
  { key: 'Enter', run: choose },
  { key: 'Space', run: choose },
  {
    key: 'Escape',
    run: (view) => {
      if (!open(view)) return false;
      view.dispatch({ effects: dismiss.of(null) });
      return true;
    },
  },
]));

/** The highlight color menu, as Obsidian suggests the colors after `==`. */
export const highlightMenu: Extension = [menuField, menuKeymap];
