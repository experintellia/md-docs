import { EditorSelection } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import { footnotes } from '../footnote.ts';
import { MAX_TEX } from './math.ts';
import { type Segment, segmentNode } from './table.ts';

/**
 * Follow a footnote reference. In read mode, to its entry in the list at the
 * end of the document; while editing, to its definition, with the caret at the
 * start of the note's text so it can be edited there. `label` is null for an
 * inline `^[note]`, which has no definition to go to.
 */
export function jumpToFootnote(view: EditorView, label: string | null, n: number | null): boolean {
  if (view.state.readOnly) {
    if (n === null) return false;
    // The list is a widget at the very end: scroll there so CodeMirror draws
    // it, then bring the entry itself into view.
    view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.length, { y: 'start' }) });
    // ponytail: two frames, one for CodeMirror's measure and one for its draw.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const item = view.dom.querySelector<HTMLElement>(`.md-footnotes li[data-fn-n="${n}"]`);
      if (!item) return;
      item.scrollIntoView({ block: 'center' });
      flash(item);
    }));
    return true;
  }
  const def = label === null ? undefined : footnotes(view.state).defs.get(label);
  if (!def) return false;
  // Past the `[^label]:` and the space after it.
  const marks = def.getChildren('FootnoteMark');
  let at = marks[marks.length - 1]?.to ?? def.from;
  while (view.state.sliceDoc(at, at + 1) === ' ') at++;
  view.dispatch({ selection: EditorSelection.cursor(at), scrollIntoView: true });
  view.focus();
  return true;
}

function flash(el: HTMLElement): void {
  el.classList.remove('md-footnote-flash');
  void el.offsetWidth; // restart the animation on a second jump to the same note
  el.classList.add('md-footnote-flash');
}

/** A reference in read mode: its number, as a superscript. */
export class FootnoteRefWidget extends WidgetType {
  readonly n: number;
  readonly label: string | null;

  constructor(n: number, label: string | null) {
    super();
    this.n = n;
    this.label = label;
  }

  override eq(other: FootnoteRefWidget): boolean {
    return other.n === this.n && other.label === this.label;
  }

  override toDOM(): HTMLElement {
    const sup = document.createElement('sup');
    sup.className = 'md-footnote-ref';
    sup.textContent = String(this.n);
    sup.dataset.fnN = String(this.n);
    if (this.label !== null) sup.dataset.fnLabel = this.label;
    return sup;
  }

  // Let the editor's click handler see the press, which follows it.
  override ignoreEvent(): boolean {
    return false;
  }
}

export interface ListedNote {
  n: number;
  /** Where the note is first referred to, for the way back. */
  ref: number;
  segments: Segment[];
}

/** Read mode's footnotes, numbered, at the end of the document, as in Obsidian. */
export class FootnoteListWidget extends WidgetType {
  readonly notes: ListedNote[];
  private readonly key: string;

  constructor(notes: ListedNote[]) {
    super();
    this.notes = notes;
    this.key = JSON.stringify(notes);
  }

  override eq(other: FootnoteListWidget): boolean {
    return other.key === this.key;
  }

  override toDOM(view: EditorView): HTMLElement {
    const section = document.createElement('section');
    section.className = 'md-footnotes';
    section.setAttribute('aria-label', 'Footnotes');
    const list = section.appendChild(document.createElement('ol'));
    const budget = { left: MAX_TEX };
    for (const note of this.notes) {
      const item = list.appendChild(document.createElement('li'));
      item.value = note.n;
      item.dataset.fnN = String(note.n);
      for (const segment of note.segments) item.append(segmentNode(segment, view, budget));
      const back = item.appendChild(document.createElement('a'));
      back.className = 'md-footnote-back';
      back.href = '#';
      back.textContent = '↩';
      back.title = 'Back to the text';
      back.setAttribute('aria-label', `Back to reference ${note.n}`);
      back.addEventListener('mousedown', (event) => event.preventDefault());
      back.addEventListener('click', (event) => {
        event.preventDefault();
        view.dispatch({ effects: EditorView.scrollIntoView(note.ref, { y: 'center' }) });
      });
    }
    return section;
  }
}
