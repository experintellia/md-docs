import { indentMore, indentLess } from '@codemirror/commands';
import type { Command, EditorView } from '@codemirror/view';
import { faSquareCheck } from '@fortawesome/free-regular-svg-icons';
import { faListUl } from '@fortawesome/free-solid-svg-icons';
import {
  cycleHeading,
  toggleBold,
  toggleBullet,
  toggleChecklist,
  toggleItalic,
} from '../commands';
import { faSvg } from './icon';

interface Action {
  /** Text glyph, or a Font Awesome icon rendered as inline SVG. */
  label: string | (() => Node);
  title: string;
  run: Command;
}

const ACTIONS: Action[] = [
  { label: 'H', title: 'Heading (cycle level)', run: cycleHeading },
  { label: 'B', title: 'Bold', run: toggleBold },
  { label: 'I', title: 'Italic', run: toggleItalic },
  { label: () => faSvg(faListUl), title: 'Bullet list', run: toggleBullet },
  { label: () => faSvg(faSquareCheck), title: 'Checklist item', run: toggleChecklist },
  { label: '⇤', title: 'Outdent list item', run: indentLess },
  { label: '⇥', title: 'Indent list item', run: indentMore },
];

/**
 * Build the editing toolbar and wire its buttons to the editor commands.
 *
 * Placement is responsive:
 *  - Desktop (fine pointer): stays at the top of the screen (default flow).
 *  - Mobile (coarse pointer): docks above the on-screen keyboard, tracked via
 *    the VisualViewport API.
 */
export function mountToolbar(container: HTMLElement, view: EditorView): void {
  container.replaceChildren();

  for (const action of ACTIONS) {
    const btn = utilButton(action.label, action.title);
    // Use mousedown + preventDefault so the editor keeps focus/selection.
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      action.run(view);
      view.focus();
    });
    container.appendChild(btn);
  }

  // Utility buttons (theme + help) pushed to the right; these are not editor
  // commands, so a plain click is fine — no need to preserve selection.
  const spacer = document.createElement('div');
  spacer.className = 'md-tool-spacer';
  container.append(spacer, themeButton(), helpButton());

  if (isMobile()) {
    enableKeyboardDocking(container);
  }
}

function utilButton(label: string | (() => Node), title: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'md-tool-btn';
  if (typeof label === 'string') btn.textContent = label;
  else btn.appendChild(label());
  btn.title = title;
  btn.setAttribute('aria-label', title);
  return btn;
}

/** Toggle dark/light and persist it. The load-time bootstrap (index.html) reads
 *  this same `color-schema` key, so the choice survives a reload. */
function themeButton(): HTMLButtonElement {
  const root = document.documentElement;
  const btn = utilButton('', 'Toggle dark / light theme');
  const sync = (): void => { btn.textContent = root.classList.contains('dark') ? '☀︎' : '☾'; };
  btn.addEventListener('click', () => {
    const dark = root.classList.toggle('dark');
    localStorage.setItem('color-schema', dark ? 'dark' : 'light');
    sync();
  });
  sync();
  return btn;
}

function helpButton(): HTMLButtonElement {
  const btn = utilButton('?', 'Help & markdown syntax');
  btn.addEventListener('click', openHelp);
  return btn;
}

let helpEl: HTMLElement | null = null;

function openHelp(): void {
  if (!helpEl) helpEl = buildHelp();
  helpEl.hidden = false;
}

function buildHelp(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.id = 'help-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="help-card" role="dialog" aria-modal="true" aria-label="Help">
      <button class="help-close" type="button" aria-label="Close help" title="Close">×</button>
      <h1>MD-Docs</h1>
      <p>A collaborative markdown editor. Everyone who opens this app in the chat
         edits the <strong>same document</strong> — changes sync to all peers, and
         the <strong>first line becomes the document's title</strong> shown in chat.</p>
      <h2>Markdown syntax</h2>
      <table>
        <tr><td><code># Heading</code></td><td>Heading (use the <strong>H</strong> button to cycle levels)</td></tr>
        <tr><td><code>**bold**</code></td><td>Bold text (<strong>B</strong>)</td></tr>
        <tr><td><code>*italic*</code></td><td>Italic text (<strong>I</strong>)</td></tr>
        <tr><td><code>- item</code></td><td>Bullet list (<strong>•</strong>)</td></tr>
        <tr><td><code>- [ ] task</code></td><td>Checklist item (<strong>☑</strong>); click the box to tick it</td></tr>
        <tr><td><code>&gt; quote</code></td><td>Block quote</td></tr>
        <tr><td><code>\`code\`</code></td><td>Inline code</td></tr>
        <tr><td><code>[text](url)</code></td><td>Link</td></tr>
      </table>
      <h2>Toolbar</h2>
      <p>Use <strong>⇥ / ⇤</strong> to indent or outdent list items, <strong>☾ / ☀</strong>
         to switch theme, and <strong>?</strong> to reopen this help.</p>
    </div>`;

  const close = (): void => { overlay.hidden = true; };
  overlay.querySelector('.help-close')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) close();
  });

  document.body.appendChild(overlay);
  return overlay;
}

function isMobile(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

/**
 * On mobile, position the toolbar just above the on-screen keyboard. The
 * VisualViewport shrinks when the keyboard opens; we pin the bar to the bottom
 * of the *visual* viewport.
 */
function enableKeyboardDocking(container: HTMLElement): void {
  const vv = window.visualViewport;
  if (!vv) return;
  container.classList.add('docked');
  document.documentElement.classList.add('toolbar-docked');

  const reposition = (): void => {
    const bottom = window.innerHeight - (vv.offsetTop + vv.height);
    container.style.transform = `translateY(${-bottom}px)`;
  };

  vv.addEventListener('resize', reposition);
  vv.addEventListener('scroll', reposition);
  reposition();
}
