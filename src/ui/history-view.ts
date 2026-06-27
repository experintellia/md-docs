import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  faArrowLeft,
  faClockRotateLeft,
  faCode,
  faEye,
  faRotateLeft,
} from '@fortawesome/free-solid-svg-icons';
import { faSvg } from './icon';
import { livePreview } from '../live-preview';
import type { Collab } from '../collab';

/**
 * Full-screen document history: a scrollable list of past versions (datetime +
 * author) reconstructed from the synced update stream (see history.ts), and a
 * read-only viewer that renders the selected version — toggleable between the
 * live-preview rendering and raw markdown. Restore writes a version back into
 * the shared doc (behind a confirm, since it changes the document for everyone).
 *
 * ponytail: a single lazily-built overlay reused across opens — a webxdc app is
 * one page, no router or per-open teardown needed.
 */
let overlay: HistoryOverlay | null = null;

export function openHistory(collab: Collab): void {
  if (!overlay) overlay = new HistoryOverlay(collab);
  overlay.open();
}

/** A toolbar button that opens the history screen. */
export function historyButton(collab: Collab): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'md-tool-btn';
  btn.appendChild(faSvg(faClockRotateLeft));
  btn.title = 'Document history';
  btn.setAttribute('aria-label', 'Document history');
  btn.addEventListener('click', () => openHistory(collab));
  return btn;
}

class HistoryOverlay {
  private readonly el: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly viewer: EditorView;
  private readonly preview = new Compartment();
  private rendered = true;
  private selected: number | null = null;

  constructor(private readonly collab: Collab) {
    this.el = document.createElement('div');
    this.el.id = 'history-overlay';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="hist-panel" role="dialog" aria-modal="true" aria-label="Document history">
        <header class="hist-header">
          <button class="md-tool-btn" data-act="back" title="Back to editor" aria-label="Back to editor"></button>
          <h1>History</h1>
          <span class="md-tool-spacer"></span>
          <button class="md-tool-btn" data-act="toggle" title="Show raw markdown" aria-label="Show raw markdown"></button>
          <button class="md-tool-btn" data-act="restore" title="Restore this version" aria-label="Restore this version"></button>
        </header>
        <div class="hist-body">
          <ul class="hist-list"></ul>
          <div class="hist-viewer"></div>
        </div>
      </div>`;

    this.btn('back').appendChild(faSvg(faArrowLeft));
    this.btn('restore').appendChild(faSvg(faRotateLeft));
    this.syncToggleIcon();

    this.listEl = this.el.querySelector('.hist-list')!;
    this.viewer = new EditorView({
      parent: this.el.querySelector('.hist-viewer')!,
      state: EditorState.create({
        doc: '',
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage, codeLanguages: [] }),
          this.preview.of(livePreview()),
        ],
      }),
    });

    this.btn('back').addEventListener('click', () => this.close());
    this.btn('toggle').addEventListener('click', () => this.togglePreview());
    this.btn('restore').addEventListener('click', () => this.restore());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden) this.close();
    });

    // Refresh while open if new versions arrive (e.g. a peer edits, or offline
    // history finishes replaying).
    this.collab.history.onChange(() => { if (!this.el.hidden) this.renderList(); });

    document.body.appendChild(this.el);
  }

  open(): void {
    this.renderList();
    this.el.hidden = false;
  }

  private close(): void {
    this.el.hidden = true;
  }

  private btn(act: string): HTMLButtonElement {
    return this.el.querySelector(`[data-act="${act}"]`)!;
  }

  private renderList(): void {
    const entries = this.collab.history.list();
    this.listEl.replaceChildren();
    // Newest first.
    for (let i = entries.length - 1; i >= 0; i--) {
      const { index, t, author } = entries[i];
      const li = document.createElement('li');
      li.className = 'hist-row';
      li.setAttribute('role', 'button');
      li.tabIndex = 0;
      if (index === this.selected) li.classList.add('selected');
      li.innerHTML = `<span class="hist-when">${new Date(t).toLocaleString()}</span>
        <span class="hist-who">${escapeHtml(author)}</span>`;
      const pick = (): void => this.select(index);
      li.addEventListener('click', pick);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      });
      this.listEl.appendChild(li);
    }
    // Default to the latest version when nothing is picked yet.
    if (this.selected === null && entries.length) this.select(entries.length - 1);
  }

  private select(index: number): void {
    this.selected = index;
    const text = this.collab.history.textAt(index);
    this.viewer.dispatch({ changes: { from: 0, to: this.viewer.state.doc.length, insert: text } });
    this.listEl.querySelectorAll('.hist-row').forEach((row, i) => {
      // rows are newest-first; map back to entry index
      const entries = this.collab.history.list();
      row.classList.toggle('selected', entries[entries.length - 1 - i]?.index === index);
    });
  }

  private togglePreview(): void {
    this.rendered = !this.rendered;
    this.viewer.dispatch({
      effects: this.preview.reconfigure(this.rendered ? livePreview() : []),
    });
    this.syncToggleIcon();
  }

  private syncToggleIcon(): void {
    const b = this.btn('toggle');
    b.replaceChildren(faSvg(this.rendered ? faCode : faEye));
    const label = this.rendered ? 'Show raw markdown' : 'Show rendered preview';
    b.title = label;
    b.setAttribute('aria-label', label);
  }

  private restore(): void {
    if (this.selected === null) return;
    const text = this.collab.history.textAt(this.selected);
    if (!window.confirm('Restore this version? This replaces the current document for everyone.')) {
      return;
    }
    const { ytext } = this.collab;
    ytext.doc!.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, text);
    });
    this.close();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!
  ));
}
