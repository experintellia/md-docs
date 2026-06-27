import type { Command, EditorView } from '@codemirror/view';
import {
  cycleHeading,
  indentList,
  outdentList,
  toggleBold,
  toggleChecklist,
  toggleItalic,
} from '../commands';

interface Action {
  label: string;
  title: string;
  run: Command;
}

const ACTIONS: Action[] = [
  { label: 'H', title: 'Heading (cycle level)', run: cycleHeading },
  { label: 'B', title: 'Bold', run: toggleBold },
  { label: 'I', title: 'Italic', run: toggleItalic },
  { label: '⇤', title: 'Outdent list item', run: outdentList },
  { label: '⇥', title: 'Indent list item', run: indentList },
  { label: '☑', title: 'Checklist item', run: toggleChecklist },
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
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'md-tool-btn';
    btn.textContent = action.label;
    btn.title = action.title;
    btn.setAttribute('aria-label', action.title);
    // Use mousedown + preventDefault so the editor keeps focus/selection.
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      action.run(view);
      view.focus();
    });
    container.appendChild(btn);
  }

  if (isMobile()) {
    enableKeyboardDocking(container);
  }
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
