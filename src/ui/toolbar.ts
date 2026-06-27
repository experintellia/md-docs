import { indentMore, indentLess } from '@codemirror/commands';
import type { Command, EditorView } from '@codemirror/view';
import {
  faCircleQuestion,
  faSquareCheck,
} from '@fortawesome/free-regular-svg-icons';
import {
  faBold,
  faHeading,
  faIndent,
  faItalic,
  faListUl,
  faMoon,
  faOutdent,
  faSun,
} from '@fortawesome/free-solid-svg-icons';
import {
  cycleHeading,
  toggleBold,
  toggleBullet,
  toggleChecklist,
  toggleItalic,
} from '../commands.ts';
import { faSvg } from './icon.ts';

interface Action {
  icon: () => Node;
  title: string;
  run: Command;
}

const ACTIONS: Action[] = [
  { icon: () => faSvg(faHeading), title: 'Heading (cycle level)', run: cycleHeading },
  { icon: () => faSvg(faBold), title: 'Bold', run: toggleBold },
  { icon: () => faSvg(faItalic), title: 'Italic', run: toggleItalic },
  { icon: () => faSvg(faListUl), title: 'Bullet list', run: toggleBullet },
  { icon: () => faSvg(faSquareCheck), title: 'Checklist item', run: toggleChecklist },
  { icon: () => faSvg(faOutdent), title: 'Outdent list item', run: indentLess },
  { icon: () => faSvg(faIndent), title: 'Indent list item', run: indentMore },
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
    const btn = utilButton(action.icon, action.title);
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

function utilButton(icon: () => Node, title: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'md-tool-btn';
  btn.appendChild(icon());
  btn.title = title;
  btn.setAttribute('aria-label', title);
  return btn;
}

/** Toggle dark/light and persist it. The load-time bootstrap (index.html) reads
 *  this same `color-schema` key, so the choice survives a reload. */
function themeButton(): HTMLButtonElement {
  const root = document.documentElement;
  const btn = utilButton(() => faSvg(faMoon), 'Toggle dark / light theme');
  // Show the sun in dark mode (tap to go light) and the moon in light mode.
  const sync = (): void => {
    btn.replaceChildren(faSvg(root.classList.contains('dark') ? faSun : faMoon));
  };
  btn.addEventListener('click', () => {
    const dark = root.classList.toggle('dark');
    localStorage.setItem('color-schema', dark ? 'dark' : 'light');
    sync();
  });
  sync();
  return btn;
}

function helpButton(): HTMLButtonElement {
  const btn = utilButton(() => faSvg(faCircleQuestion), 'Help & markdown syntax');
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
  // Inline the toolbar's own icons so the help mirrors the buttons exactly.
  const ico = (def: Parameters<typeof faSvg>[0]): string => faSvg(def).outerHTML;
  overlay.innerHTML = `
    <div class="help-card" role="dialog" aria-modal="true" aria-label="Help">
      <button class="help-close" type="button" aria-label="Close help" title="Close">×</button>
      <h1>MD-Docs</h1>
      <p>A collaborative markdown editor. Everyone who opens this app in the chat
         edits the <strong>same document</strong> — changes sync to all peers, and
         the <strong>first line becomes the document's title</strong> shown in chat.</p>
      <h2>Markdown syntax</h2>
      <table>
        <tr><td><code># Heading</code></td><td>Heading (use the ${ico(faHeading)} button to cycle levels)</td></tr>
        <tr><td><code>**bold**</code></td><td>Bold text (${ico(faBold)})</td></tr>
        <tr><td><code>*italic*</code></td><td>Italic text (${ico(faItalic)})</td></tr>
        <tr><td><code>- item</code></td><td>Bullet list (${ico(faListUl)})</td></tr>
        <tr><td><code>- [ ] task</code></td><td>Checklist item (${ico(faSquareCheck)}); click the box to tick it</td></tr>
        <tr><td><code>&gt; quote</code></td><td>Block quote</td></tr>
        <tr><td><code>\`code\`</code></td><td>Inline code</td></tr>
        <tr><td><code>[text](url)</code></td><td>Link</td></tr>
      </table>
      <h2>Toolbar</h2>
      <p>Use ${ico(faIndent)} / ${ico(faOutdent)} to indent or outdent list items,
         ${ico(faMoon)} / ${ico(faSun)} to switch theme, and ${ico(faCircleQuestion)}
         to reopen this help.</p>
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
