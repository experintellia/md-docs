import type { IconDefinition } from '@fortawesome/fontawesome-common-types';

const NS = 'http://www.w3.org/2000/svg';

/**
 * Render a Font Awesome icon definition to an inline SVG element.
 *
 * We import individual icons (e.g. `faSquareCheck`) so the bundler tree-shakes
 * everything else away — only the icons actually used reach the webxdc bundle,
 * and the heavy `@fortawesome/fontawesome-svg-core` runtime is avoided entirely.
 * `fill: currentColor` lets the glyph follow the theme like the text buttons.
 */
export function faSvg(def: IconDefinition): SVGSVGElement {
  const [width, height, , , path] = def.icon;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of Array.isArray(path) ? path : [path]) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

/** A toolbar button showing `icon`, labelled `title` for hover and screen readers. */
export function utilButton(icon: () => Node, title: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'md-tool-btn';
  btn.appendChild(icon());
  btn.title = title;
  btn.setAttribute('aria-label', title);
  return btn;
}

/**
 * Run `run` when `el` is pressed, without taking focus from the editor.
 * A pointer acts on mousedown, preventDefault'ed so the caret and selection
 * stay put. A keyboard press is a click with no mousedown before it. Screen
 * readers send mousedown and then click, so a click right after a mousedown is
 * not run again; tracked with a flag, as `detail` is 0 for those too.
 *
 * A click that runs nothing is cancelled: that one, or one where `run`
 * returns false. On a checkbox that keeps the native box from flipping on its
 * own; a click that does run keeps its flip, which is the new state.
 */
export function onPress(el: HTMLElement, run: () => boolean | void): void {
  let pressed = false;
  el.addEventListener('mousedown', (e) => {
    e.preventDefault();
    pressed = true;
    run();
  });
  // Dragged off before letting go: no click follows to clear the flag.
  el.addEventListener('mouseleave', () => { pressed = false; });
  el.addEventListener('click', (e) => {
    if (pressed || run() === false) e.preventDefault();
    pressed = false;
  });
}
