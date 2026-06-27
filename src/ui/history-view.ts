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
import { faSvg } from './icon.ts';
import { livePreview } from '../live-preview/index.ts';
import type { Collab } from '../collab.ts';
import type { HistoryVersion } from '../history.ts';

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
  private readonly bannerEl: HTMLElement;
  private readonly viewer: EditorView;
  private readonly preview = new Compartment();
  private rendered = true;
  private selected: number | null = null;
  private rows: HistoryVersion[] = [];
  private readonly collab: Collab;

  constructor(collab: Collab) {
    this.collab = collab;
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
          <div class="hist-viewer">
            <div class="hist-banner" hidden></div>
            <div class="hist-cm"></div>
          </div>
        </div>
      </div>`;

    this.btn('back').appendChild(faSvg(faArrowLeft));
    this.btn('restore').appendChild(faSvg(faRotateLeft));
    this.syncToggleIcon();

    this.listEl = this.el.querySelector('.hist-list')!;
    this.bannerEl = this.el.querySelector('.hist-banner')!;
    this.viewer = new EditorView({
      parent: this.el.querySelector('.hist-cm')!,
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
    this.rows = this.collab.history.versions();
    this.listEl.replaceChildren();
    // Newest first.
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const { t, author, added, removed, restoredFrom } = this.rows[i];
      const li = document.createElement('li');
      li.className = 'hist-row';
      li.setAttribute('role', 'button');
      li.tabIndex = 0;
      if (i === this.selected) li.classList.add('selected');
      const rel = relativeTime(t);
      const ico = restoredFrom
        ? `<span class="hist-restored-ico" title="Restored version">${faSvg(faRotateLeft).outerHTML}</span> `
        : '';
      li.innerHTML = `<span class="hist-when">${ico}${new Date(t).toLocaleTimeString()}${
        rel ? ` · ${rel}` : ''}</span>
        <span class="hist-meta">
          <span class="hist-who">${escapeHtml(author)}</span>
          ${added || removed ? `<span class="hist-diff"
            ><span class="hist-add">+${added}</span> <span class="hist-del">−${removed}</span></span>` : ''}
        </span>`;
      const pick = (): void => this.select(i);
      li.addEventListener('click', pick);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      });
      this.listEl.appendChild(li);
    }
    // Keep the selection valid as new versions arrive; default to the latest.
    if ((this.selected === null || this.selected >= this.rows.length) && this.rows.length) {
      this.select(this.rows.length - 1);
    }
  }

  private select(index: number): void {
    this.selected = index;
    const v = this.rows[index];
    this.viewer.dispatch({
      changes: { from: 0, to: this.viewer.state.doc.length, insert: v?.text ?? '' },
    });
    const from = v?.restoredFrom;
    this.bannerEl.hidden = !from;
    if (from) {
      this.bannerEl.textContent =
        `Restored from ${new Date(from.t).toLocaleString()} · ${from.author}`;
    }
    this.listEl.querySelectorAll('.hist-row').forEach((row, i) => {
      // rows are rendered newest-first; map display position back to row index.
      row.classList.toggle('selected', this.rows.length - 1 - i === index);
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
    const v = this.rows[this.selected];
    if (!v) return;
    if (!window.confirm('Restore this version? This replaces the current document for everyone.')) {
      return;
    }
    // Tag the resulting batch so every peer's timeline marks it as a restore.
    this.collab.history.markRestore({ t: v.t, author: v.author });
    const { ytext } = this.collab;
    ytext.doc!.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, v.text);
    });
    this.close();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!
  ));
}

// Short relative label for timestamps within the last hour; null otherwise (the
// absolute time already covers older versions). ponytail: no ticking refresh —
// the list re-renders whenever history changes, which is often enough.
function relativeTime(t: number): string | null {
  const diff = Date.now() - t;
  if (diff < 0 || diff >= 3_600_000) return null;
  const mins = Math.floor(diff / 60_000);
  return mins < 1 ? 'just now' : `${mins} min ago`;
}
