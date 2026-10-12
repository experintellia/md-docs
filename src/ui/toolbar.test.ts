import { test, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { EditorState, Transaction, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import type { Collab } from '../collab.ts';

GlobalRegistrator.register();
// happy-dom's matchMedia may be missing; stub to desktop so keyboard-docking is skipped.
window.matchMedia = (): MediaQueryList =>
  ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;

const { mountToolbar } = await import('./toolbar.ts');
const { createEditor } = await import('../editor.ts');
const { runScopeHandlers } = await import('@codemirror/view');
after(() => GlobalRegistrator.unregister());

// Stub view: the toolbar commands only read `view.state`, call `view.dispatch`,
// and `view.focus()` — mirror commands.test.ts's stand-in over a real EditorState.
function makeView(doc: string, anchor: number, head: number): { view: EditorView; doc: () => string } {
  let state = EditorState.create({ doc, selection: { anchor, head } });
  const view = {
    get state() {
      return state;
    },
    dispatch(tr: Transaction | TransactionSpec) {
      state = tr instanceof Transaction ? tr.state : state.update(tr).state;
    },
    focus() {},
  } as unknown as EditorView;
  return { view, doc: () => state.doc.toString() };
}

function reset(): HTMLElement {
  document.documentElement.className = '';
  localStorage.clear();
  // The help overlay is a module-level singleton appended once; don't remove it
  // between tests (it would orphan the cached node). Just ensure it's closed.
  document.querySelector<HTMLElement>('#help-overlay')?.setAttribute('hidden', '');
  return document.createElement('div');
}

function btnByTitle(container: HTMLElement, title: string): HTMLButtonElement {
  const btn = container.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
  assert.ok(btn, `button "${title}" should exist`);
  return btn;
}

const COMMAND_TITLES = [
  'Heading (cycle level)',
  'Bold',
  'Italic',
  'Bullet list',
  'Checklist item',
  'Outdent list item',
  'Indent list item',
];

test('mountToolbar builds the 7 command buttons with title + aria-label', () => {
  const container = reset();
  const { view } = makeView('hi', 0, 0);
  mountToolbar(container, view);

  for (const title of COMMAND_TITLES) {
    const btn = btnByTitle(container, title);
    assert.equal(btn.getAttribute('aria-label'), title);
  }
  // spacer + theme + help utility buttons
  assert.ok(container.querySelector('.md-tool-spacer'), 'spacer exists');
  assert.ok(btnByTitle(container, 'Toggle dark / light theme'));
  assert.ok(btnByTitle(container, 'Help & markdown syntax'));
});

test('Bold button wraps the selection in **…**', () => {
  const container = reset();
  const { view, doc } = makeView('ab', 0, 2); // whole word selected
  mountToolbar(container, view);

  btnByTitle(container, 'Bold').dispatchEvent(
    new window.Event('mousedown', { bubbles: true, cancelable: true }),
  );
  assert.equal(doc(), '**ab**');
});

test('Italic button wraps the selection in *…*', () => {
  const container = reset();
  const { view, doc } = makeView('ab', 0, 2);
  mountToolbar(container, view);
  btnByTitle(container, 'Italic').dispatchEvent(
    new window.Event('mousedown', { bubbles: true, cancelable: true }),
  );
  assert.equal(doc(), '*ab*');
});

test('theme toggle adds/removes dark class and persists color-schema', () => {
  const container = reset();
  const { view } = makeView('hi', 0, 0);
  mountToolbar(container, view);
  const theme = btnByTitle(container, 'Toggle dark / light theme');

  assert.equal(document.documentElement.classList.contains('dark'), false);

  theme.click();
  assert.equal(document.documentElement.classList.contains('dark'), true);
  assert.equal(localStorage.getItem('color-schema'), 'dark');

  theme.click();
  assert.equal(document.documentElement.classList.contains('dark'), false);
  assert.equal(localStorage.getItem('color-schema'), 'light');
});

test('read mode stops input, renders the caret line, and hides the edit buttons', () => {
  const container = reset();
  // Caret on the link line: in edit mode that line shows its raw markdown.
  const doc = '[a](https://a.example)\n- [ ] task';
  const view = createEditor(document.body, doc);
  try {
    mountToolbar(container, view);
    const toggle = btnByTitle(container, 'Toggle read / edit mode');
    const link = (): Element | null => view.contentDOM.querySelector('.md-link[data-href]');
    assert.equal(link(), null, 'edit mode: the caret line is source, not a link');
    view.focus();

    toggle.click();
    assert.equal(view.state.readOnly, true);
    assert.equal(view.contentDOM.getAttribute('contenteditable'), 'false');
    assert.ok(document.activeElement !== view.contentDOM, 'the keyboard goes away');
    assert.equal(toggle.getAttribute('aria-pressed'), 'true');
    assert.ok(container.classList.contains('reading'));
    for (const title of COMMAND_TITLES) {
      assert.ok(btnByTitle(container, title).classList.contains('md-tool-cmd'), `${title} hides`);
    }
    assert.ok(link(), 'read mode: the caret line renders, so the link is tappable');
    const box = view.contentDOM.querySelector<HTMLInputElement>('.md-task-checkbox')!;
    box.dispatchEvent(new window.Event('mousedown', { bubbles: true, cancelable: true }));
    box.click();
    assert.equal(view.state.doc.toString(), doc, 'a checkbox tap changes nothing');
    assert.equal(box.checked, false, 'nor does the box tick itself');

    toggle.click();
    assert.equal(view.state.readOnly, false);
    assert.equal(view.contentDOM.getAttribute('contenteditable'), 'true');
    assert.equal(container.classList.contains('reading'), false);
    assert.equal(link(), null);
  } finally {
    view.destroy();
  }
});

test('read mode renders a table under the caret, and edit mode reveals it again', () => {
  const container = reset();
  const view = createEditor(document.body, '| a | b |\n| - | - |\n| 1 | 2 |');
  try {
    mountToolbar(container, view);
    const table = (): Element | null => view.contentDOM.querySelector('.md-table');
    assert.equal(table(), null, 'the caret is in it, so it is source');
    btnByTitle(container, 'Toggle read / edit mode').click();
    assert.ok(table());
    btnByTitle(container, 'Toggle read / edit mode').click();
    assert.equal(table(), null);
  } finally {
    view.destroy();
  }
});

test('in read mode no shortcut edits, ours included', () => {
  // A focused task checkbox hands its keys to the keymap, and our commands
  // (unlike CodeMirror's) don't check readOnly themselves.
  const container = reset();
  const view = createEditor(document.body, 'ab');
  const ctrlB = (): boolean => runScopeHandlers(
    view, new window.KeyboardEvent('keydown', { key: 'b', ctrlKey: true }) as KeyboardEvent, 'editor',
  );
  try {
    mountToolbar(container, view);
    view.dispatch({ selection: { anchor: 0, head: 2 } });
    btnByTitle(container, 'Toggle read / edit mode').click();
    ctrlB();
    assert.equal(view.state.doc.toString(), 'ab');
    btnByTitle(container, 'Toggle read / edit mode').click();
    ctrlB();
    assert.equal(view.state.doc.toString(), '**ab**', 'the same key edits in edit mode');
  } finally {
    view.destroy();
  }
});

test('going into read mode takes our caret off peers\' screens', () => {
  const container = reset();
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('t');
  const awareness = new Awareness(ydoc);
  const collab = { ydoc, ytext, awareness, undoManager: new Y.UndoManager(ytext) } as unknown as Collab;
  const view = createEditor(document.body, '', [], collab);
  try {
    mountToolbar(container, view, collab);
    // What y-codemirror publishes while the editor has focus.
    awareness.setLocalStateField('cursor', { anchor: 0, head: 0 });
    btnByTitle(container, 'Toggle read / edit mode').click();
    assert.equal(awareness.getLocalState()?.cursor, null);
  } finally {
    view.destroy();
    awareness.destroy(); // its timer would keep the test process alive
    ydoc.destroy();
  }
});

test('the more menu holds theme and help, and closes after use, outside or on Escape', () => {
  const container = reset();
  document.body.append(container); // for focus
  try {
    const { view } = makeView('hi', 0, 0);
    mountToolbar(container, view);
    const more = btnByTitle(container, 'More');
    const menu = container.querySelector('.md-tool-menu')!;
    const theme = btnByTitle(container, 'Toggle dark / light theme');
    assert.ok(menu.contains(theme) && menu.contains(btnByTitle(container, 'Help & markdown syntax')));
    assert.ok(more.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING, 'Tab goes ⋮ → items');
    const isOpen = (): boolean => menu.classList.contains('open');

    more.click();
    assert.ok(isOpen());
    assert.equal(more.getAttribute('aria-expanded'), 'true');
    theme.focus();
    theme.click();
    assert.equal(isOpen(), false, 'an item closes the menu');
    assert.ok(document.documentElement.classList.contains('dark'), 'and still does its job');
    assert.ok(document.activeElement === more, 'focus goes back to ⋮, not <body>');

    more.click();
    document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    assert.equal(isOpen(), false, 'a tap outside closes it');

    more.click();
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(isOpen(), false, 'Escape closes it');
    assert.equal(more.getAttribute('aria-expanded'), 'false');
  } finally {
    container.remove();
  }
});

test('help button opens the overlay and the close button hides it', () => {
  const container = reset();
  const { view } = makeView('hi', 0, 0);
  mountToolbar(container, view);

  btnByTitle(container, 'Help & markdown syntax').click();
  const overlay = document.querySelector<HTMLElement>('#help-overlay');
  assert.ok(overlay, 'overlay exists');
  assert.equal(overlay.hidden, false);

  overlay.querySelector<HTMLButtonElement>('.help-close')!.click();
  assert.equal(overlay.hidden, true);

  // The ← of the full-screen layout closes it the same way.
  btnByTitle(container, 'Help & markdown syntax').click();
  overlay.querySelector<HTMLButtonElement>('.help-back')!.click();
  assert.equal(overlay.hidden, true);
});

test('Escape keydown closes an open help overlay', () => {
  const container = reset();
  const { view } = makeView('hi', 0, 0);
  mountToolbar(container, view);

  btnByTitle(container, 'Help & markdown syntax').click();
  const overlay = document.querySelector<HTMLElement>('#help-overlay');
  assert.ok(overlay);
  assert.equal(overlay.hidden, false);

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(overlay.hidden, true);
});
