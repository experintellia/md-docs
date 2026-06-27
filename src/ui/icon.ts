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
