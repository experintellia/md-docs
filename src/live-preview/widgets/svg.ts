import { type EditorView, WidgetType } from '@codemirror/view';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

// What a drawing needs, and nothing that runs, navigates or loads: no script,
// foreignObject, image, style, or animation (`<set attributeName="href"
// to="javascript:…">` turns a harmless `<a>` into a link). Names as the HTML
// parser gives them, case and all.
const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc', 'a', 'switch',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath',
  'linearGradient', 'radialGradient', 'stop', 'pattern', 'clipPath', 'mask', 'marker',
  'filter', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite',
  'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight',
  'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR',
  'feGaussianBlur', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset',
  'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence',
]);

// A value that could fetch: any `url(` but one to an element of the file
// (`url(#grad)`), CSS's other loaders, an at-rule, and any backslash, since
// a CSS escape (`u\72l(`) spells all of these past a pattern.
const FETCHES = /\\|@|url\s*\(\s*['"]?\s*(?!#)|src\s*\(|image(-set)?\s*\(/i;

// Is this element, and each of its attributes, one we keep? A prefixed name
// (`x:script`, `x:href`) is checked by what it becomes, not what it is here:
// the HTML parser keeps the prefix in the local name, and once serialized and
// read back as XML the prefix is a namespace again.
const keepElement = (el: Element): boolean =>
  el.namespaceURI === SVG_NS && ELEMENTS.has(el.localName);
const keepAttr = (attr: Attr): boolean =>
  !attr.localName.includes(':')
  && !/^(on|xmlns)/i.test(attr.localName)
  && (attr.namespaceURI === null || (attr.namespaceURI === XLINK_NS && attr.localName === 'href'))
  && (attr.localName !== 'href' || attr.value.trim().startsWith('#'))
  && !FETCHES.test(attr.value);

/**
 * The SVG with only drawing left in it, serialized, or null if the source is
 * not a single `<svg>` element. The document comes from other chat members.
 *
 * The widget draws it as an `<img>`, which already runs no script and loads
 * nothing; this keeps the image a drawing wherever else it ends up (a
 * long-press "save image" on a phone hands on exactly this). Elements are
 * allowlisted; attributes lose handlers, prefixes and anything that could
 * fetch, links point only within the file (`#id`), and nothing in it reaches
 * the network.
 */
export function sanitizeSvg(source: string): string | null {
  // Read as HTML, which is how `<svg>` written into a page is read: no
  // `xmlns` needed, and a tag left open is closed rather than an error.
  const body = new DOMParser().parseFromString(source, 'text/html').body;
  const root = body.firstElementChild;
  if (body.childNodes.length !== 1 || root?.localName !== 'svg' || root.namespaceURI !== SVG_NS) return null;
  for (const el of [...root.querySelectorAll('*')]) {
    if (!keepElement(el)) el.remove();
  }
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      if (!keepAttr(attr)) el.removeAttributeNode(attr);
    }
  }
  const svg = new XMLSerializer().serializeToString(root);
  // Read back the way a saved file would be, and refuse it if that reads as
  // anything we did not keep — whatever else the round trip turns out to do.
  const back = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const all = [back, ...back.querySelectorAll('*')];
  return all.every((el) => keepElement(el) && [...el.attributes].every((a) => keepAttr(a) || /^xmlns(:|$)/.test(a.name)))
    ? svg
    : null;
}

// ponytail: one entry per distinct `<svg>` source seen, dropped wholesale past
// 100 — a count, not a size: 100 huge SVGs are held whole until then. `buildSvg` asks on every caret move; parsing is what this saves.
const cache = new Map<string, string | null>();
export function sanitizedSvg(source: string): string | null {
  if (!cache.has(source)) {
    if (cache.size >= 100) cache.clear();
    cache.set(source, sanitizeSvg(source));
  }
  return cache.get(source)!;
}

/**
 * A raw `<svg>` block, drawn from its sanitized markup. A tap opens its source,
 * as on a table or a `$$` block; a pinch zooms it until the fingers lift.
 */
export class SvgWidget extends WidgetType {
  readonly svg: string;

  constructor(svg: string) {
    super();
    this.svg = svg;
  }

  // The markup alone, not the position: text typed above the block — a peer's
  // included — would otherwise redraw it every key.
  override eq(other: SvgWidget): boolean {
    return other.svg === this.svg;
  }

  override toDOM(view: EditorView): HTMLElement {
    const img = document.createElement('img');
    img.className = 'md-svg';
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(this.svg)}`;
    img.alt = 'SVG image';
    // The block's height is only known once the image is: tell CodeMirror,
    // whose height map would otherwise be off until something else moves.
    img.addEventListener('load', () => view.requestMeasure());
    // A widget swallows its events, so a tap would never reach the source.
    // Asked of the DOM, not remembered: text typed above moves the block.
    img.addEventListener('mousedown', (event) => {
      event.preventDefault();
      // Read mode reveals no source, so a tap has nothing to open.
      if (view.state.readOnly) return;
      // Before the dispatch, which removes this element: the keyboard comes up.
      view.focus();
      view.dispatch({ selection: { anchor: view.posAtDOM(img) } });
    });
    pinchZoom(img);
    return img;
  }
}

// Two fingers' distance apart and the point midway between them.
function pinch(touches: TouchList): { dist: number; x: number; y: number } {
  const [a, b] = [touches[0], touches[1]];
  return {
    dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
  };
}

/**
 * Pinch the image to look closer, and pan it with the same two fingers; it
 * springs back once they lift. Two fingers only, so a tap still opens the
 * source and one finger still scrolls the note. `touch-action` (CSS) keeps
 * the browser's own page zoom out of it, and preventDefault does for a
 * webview that ignores that.
 */
function pinchZoom(img: HTMLElement): void {
  let start: ReturnType<typeof pinch> | null = null;
  img.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 2) return;
    start = pinch(event.touches);
    // Grow from between the fingers, not from the image's centre.
    const box = img.getBoundingClientRect();
    img.style.transformOrigin = `${start.x - box.left}px ${start.y - box.top}px`;
    img.classList.add('md-svg-zoom');
  }, { passive: true });
  img.addEventListener('touchmove', (event) => {
    if (!start || event.touches.length !== 2) return;
    event.preventDefault();
    const now = pinch(event.touches);
    const scale = Math.min(8, Math.max(1, now.dist / start.dist));
    img.style.transform = `translate(${now.x - start.x}px, ${now.y - start.y}px) scale(${scale})`;
  }, { passive: false });
  const end = (event: TouchEvent): void => {
    if (!start || event.touches.length >= 2) return;
    start = null;
    img.classList.remove('md-svg-zoom');
    img.style.transform = '';
  };
  img.addEventListener('touchend', end);
  img.addEventListener('touchcancel', end);
}
