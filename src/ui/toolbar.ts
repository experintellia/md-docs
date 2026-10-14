import { indentMore, indentLess } from '@codemirror/commands';
import type { Command, EditorView } from '@codemirror/view';
import {
  faCircleQuestion,
  faSquareCheck,
} from '@fortawesome/free-regular-svg-icons';
import {
  faArrowLeft,
  faBold,
  faBookOpen,
  faClockRotateLeft,
  faEllipsisVertical,
  faHeading,
  faIndent,
  faItalic,
  faListUl,
  faMoon,
  faOutdent,
  faPen,
  faSun,
} from '@fortawesome/free-solid-svg-icons';
import {
  cycleHeading,
  toggleBold,
  toggleBullet,
  toggleChecklist,
  toggleItalic,
} from '../commands.ts';
import { setReadMode } from '../editor.ts';
import { faSvg, onPress, utilButton } from './icon.ts';
import { trapFocus } from './modal.ts';
import { historyButton } from './history-view.ts';
import { isMobile } from '../peer-flags.ts';
import type { Collab } from '../collab.ts';

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
export function mountToolbar(container: HTMLElement, view: EditorView, collab?: Collab): void {
  container.replaceChildren();

  for (const action of ACTIONS) {
    const btn = utilButton(action.icon, action.title);
    btn.classList.add('md-tool-cmd'); // hidden in read mode, see readModeButton
    onPress(btn, () => {
      action.run(view);
      view.focus();
    });
    container.appendChild(btn);
  }

  // Utility buttons (read mode, history, theme, help) pushed to the right;
  // these are not editor commands, so a plain click is fine — no need to
  // preserve selection.
  const spacer = document.createElement('div');
  spacer.className = 'md-tool-spacer';
  // History needs the synced update stream, so only when collaborating.
  const utils = [...(collab ? [historyButton(collab)] : []), themeButton(), helpButton()];
  const end = document.createElement('div');
  end.className = 'md-tool-end';
  end.append(readModeButton(container, view), ...moreMenu(utils));
  container.append(spacer, end);

  if (isMobile()) {
    fitAppToViewport();
  }
}

/** Toggle read mode: the editor stops taking input and shows no source, so a
 *  tap on a link opens it. The editing buttons have nothing to act on there,
 *  so they step aside. Not persisted: every open starts in edit mode. */
function readModeButton(container: HTMLElement, view: EditorView): HTMLButtonElement {
  const btn = utilButton(() => faSvg(faBookOpen), 'Toggle read / edit mode');
  btn.setAttribute('aria-pressed', 'false');
  btn.addEventListener('click', () => {
    const reading = container.classList.toggle('reading');
    setReadMode(view, reading);
    // Drop the keyboard on the way in. On the way out, leave focus alone: the
    // next tap puts the caret where the reader wants to edit.
    if (reading) view.contentDOM.blur();
    btn.setAttribute('aria-pressed', String(reading));
    // Like the theme button: show the mode a tap switches to.
    btn.replaceChildren(faSvg(reading ? faPen : faBookOpen));
  });
  return btn;
}

/**
 * History, theme and help, plus the "more" button that folds them into a menu.
 * Whether they sit inline or behind the button is up to CSS (narrow screens and
 * touch get the menu, see main.css), so the same buttons serve both layouts.
 */
function moreMenu(items: HTMLButtonElement[]): HTMLElement[] {
  const menu = document.createElement('div');
  menu.className = 'md-tool-menu';
  menu.append(...items);
  const more = utilButton(() => faSvg(faEllipsisVertical), 'More');
  more.classList.add('md-tool-more');
  more.setAttribute('aria-expanded', 'false');

  const setOpen = (open: boolean): void => {
    menu.classList.toggle('open', open);
    more.setAttribute('aria-expanded', String(open));
  };
  // Closing from inside hands focus back to the button instead of <body>.
  const close = (): void => {
    if (menu.contains(document.activeElement)) more.focus();
    setOpen(false);
  };
  more.addEventListener('click', () => setOpen(!menu.classList.contains('open')));
  // Capture: the menu has done its job, and focus is back on ⋮ before the
  // item's own handler runs, so a dialog the item opens hands focus back to ⋮
  // rather than to an item the closed menu hides.
  menu.addEventListener('click', close, true);
  // Tabbing out closes it; focus moving to ⋮ doesn't, or ⋮'s own click
  // would reopen what the focus change had just closed.
  menu.addEventListener('focusout', (e) => {
    const to = e.relatedTarget as Node | null;
    if (to !== more && !menu.contains(to)) setOpen(false);
  });
  // pointerdown, not click: iOS fires no click for a tap on an element that
  // doesn't listen for one, such as the editor's empty bottom padding.
  document.addEventListener('pointerdown', (e) => {
    if (!menu.contains(e.target as Node) && !more.contains(e.target as Node)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.classList.contains('open')) close();
  });
  // The button first, so Tab goes from it into the items.
  return [more, menu];
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
let releaseHelp: (() => void) | null = null;

function openHelp(): void {
  if (!helpEl) helpEl = buildHelp();
  helpEl.hidden = false;
  releaseHelp = trapFocus(helpEl, helpEl.querySelector('.help-card')!);
}

function buildHelp(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.id = 'help-overlay';
  overlay.hidden = true;
  // Inline the toolbar's own icons so the help mirrors the buttons exactly.
  const ico = (def: Parameters<typeof faSvg>[0]): string => faSvg(def).outerHTML;
  overlay.innerHTML = `
    <div class="help-card" role="dialog" aria-modal="true" aria-label="Help" tabindex="-1">
      <button class="help-close" type="button" aria-label="Close help" title="Close">×</button>
      <div class="help-head">
        <button class="md-tool-btn help-back" type="button" aria-label="Back to editor"
          title="Back to editor">${ico(faArrowLeft)}</button>
        <h1>MD-Docs</h1>
      </div>
      <p>A collaborative markdown editor. Everyone who opens this app in the chat
         edits the <strong>same document</strong> — changes sync to all peers, and
         the <strong>first line becomes the document's title</strong> shown in chat.</p>
      <h2>Markdown syntax</h2>
      <table>
        <tbody>
          <tr><td><code># Heading</code></td><td>Heading (use the ${ico(faHeading)} button to cycle levels)</td></tr>
          <tr><td><code>**bold**</code></td><td>Bold text (${ico(faBold)})</td></tr>
          <tr><td><code>*italic*</code></td><td>Italic text (${ico(faItalic)})</td></tr>
          <tr><td><code>~~text~~</code></td><td>Strikethrough</td></tr>
          <tr><td><code>\`code\`</code></td><td>Inline code</td></tr>
          <tr><td><code>[text](url)</code></td><td>Link</td></tr>
          <tr><td><code>$x^2$</code></td><td>Math (LaTeX) in the text</td></tr>
        </tbody>
        <tbody>
          <tr><td><code>- item</code></td><td>Bullet list (${ico(faListUl)})</td></tr>
          <tr><td><code>1. item</code></td><td>Numbered list</td></tr>
          <tr><td><code>- [ ] task</code></td><td>Checklist item (${ico(faSquareCheck)}); click the box to tick it</td></tr>
        </tbody>
        <tbody>
          <tr><td><code>&gt; quote</code></td><td>Block quote</td></tr>
          <tr><td><pre><code>\`\`\`js&#10;let x = 1&#10;\`\`\`</code></pre></td><td>Code block, highlighted for the language after <code>\`\`\`</code> (js, py, sh, …)</td></tr>
          <tr><td><pre><code>| a | b |&#10;|---|---|&#10;| 1 | 2 |</code></pre></td><td>Table, with a <code>|---|</code> line under the header row</td></tr>
          <tr><td><pre><code>$$&#10;x^2&#10;$$</code></pre></td><td>Math (LaTeX) on a line of its own, between <code>$$</code></td></tr>
          <tr><td><code>---</code></td><td>Separator line (three or more minuses on their own line)</td></tr>
        </tbody>
      </table>
      <h2>Toolbar</h2>
      <table class="help-tools">
        <tr><td>${ico(faIndent)}${ico(faOutdent)}</td><td>Indent or outdent a list item</td></tr>
        <tr><td>${ico(faBookOpen)}${ico(faPen)}</td><td>Read (links open on tap, nothing can change) or edit</td></tr>
        <tr><td>${ico(faClockRotateLeft)}</td><td>Browse and restore past versions</td></tr>
        <tr><td>${ico(faMoon)}${ico(faSun)}</td><td>Dark or light theme</td></tr>
        <tr><td>${ico(faCircleQuestion)}</td><td>This help</td></tr>
      </table>
      <p class="help-note">On a phone or in a narrow window, history, theme and
         help sit behind ${ico(faEllipsisVertical)}.</p>
    </div>`;

  const close = (): void => {
    overlay.hidden = true;
    releaseHelp?.();
    releaseHelp = null;
  };
  // × on the dialog, ← on the full screen a narrow display gets (main.css).
  for (const btn of overlay.querySelectorAll('.help-close, .help-back')) {
    btn.addEventListener('click', close);
  }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) close();
  });

  document.body.appendChild(overlay);
  return overlay;
}

/**
 * On mobile, size #app to the *visual* viewport so its bottom edge sits exactly
 * above the on-screen keyboard. The toolbar is the last flex child (CSS), so it
 * floats just above the keyboard with no position:fixed bar that iOS could drop.
 * iOS doesn't shrink the layout viewport (or vh/dvh) for the keyboard — only
 * visualViewport reflects it — so the height has to come from JS.
 */
function fitAppToViewport(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const app = document.getElementById('app');
  if (!app) return;

  const fit = (): void => {
    app.style.height = `${vv.height}px`;
    // Covers any residual layout-viewport scroll/offset (e.g. pinch-zoom).
    app.style.transform = `translateY(${vv.offsetTop}px)`;
  };

  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
  fit();
}
