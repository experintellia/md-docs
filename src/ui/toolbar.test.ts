import { test, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { EditorState, Transaction, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

GlobalRegistrator.register();
// happy-dom's matchMedia may be missing; stub to desktop so keyboard-docking is skipped.
window.matchMedia = (): MediaQueryList =>
  ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;

const { mountToolbar } = await import('./toolbar.ts');
const { createEditor } = await import('../editor.ts');
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

    toggle.click();
    assert.equal(view.state.readOnly, true);
    assert.equal(view.contentDOM.getAttribute('contenteditable'), 'false');
    assert.equal(toggle.getAttribute('aria-pressed'), 'true');
    assert.ok(container.classList.contains('reading'), 'edit buttons hidden via CSS');
    assert.ok(link(), 'read mode: the caret line renders, so the link is tappable');
    view.contentDOM.querySelector('.md-task-checkbox')!.dispatchEvent(
      new window.Event('mousedown', { bubbles: true, cancelable: true }),
    );
    assert.equal(view.state.doc.toString(), doc, 'a checkbox tap changes nothing');

    toggle.click();
    assert.equal(view.state.readOnly, false);
    assert.equal(view.contentDOM.getAttribute('contenteditable'), 'true');
    assert.equal(container.classList.contains('reading'), false);
    assert.equal(link(), null);
  } finally {
    view.destroy();
  }
});

test('the more menu holds theme and help, and closes after use, outside or on Escape', () => {
  const container = reset();
  const { view } = makeView('hi', 0, 0);
  mountToolbar(container, view);
  const more = btnByTitle(container, 'More');
  const menu = container.querySelector('.md-tool-menu')!;
  const theme = btnByTitle(container, 'Toggle dark / light theme');
  assert.ok(menu.contains(theme) && menu.contains(btnByTitle(container, 'Help & markdown syntax')));
  const isOpen = (): boolean => menu.classList.contains('open');

  more.click();
  assert.ok(isOpen());
  assert.equal(more.getAttribute('aria-expanded'), 'true');
  theme.click();
  assert.equal(isOpen(), false, 'an item closes the menu');
  assert.ok(document.documentElement.classList.contains('dark'), 'and still does its job');

  more.click();
  document.body.click();
  assert.equal(isOpen(), false, 'a tap outside closes it');

  more.click();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(isOpen(), false, 'Escape closes it');
  assert.equal(more.getAttribute('aria-expanded'), 'false');
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
