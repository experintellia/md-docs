import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  faArrowLeft,
  faClockRotateLeft,
  faCode,
  faCodeCompare,
  faEye,
  faRotateLeft,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
import { faSvg } from './icon.ts';
import { livePreview } from '../live-preview/index.ts';
import type { Collab } from '../collab.ts';
import type { HistoryVersion } from '../history.ts';

/**
 * Full-screen document history: a scrollable list of past versions (datetime +
 * author) reconstructed from the synced update stream (see history.ts), and a
 * read-only viewer that shows the selected version in one of three modes,
 * picked from a small menu: rendered markdown, raw source, or a diff against the
 * previous version. Restore writes a version back into the shared doc (behind a
 * confirm, since it changes the document for everyone).
 *
 * ponytail: a single lazily-built overlay reused across opens — a webxdc app is
 * one page, no router or per-open teardown needed.
 */
type ViewMode = 'rendered' | 'source' | 'diff';
const MODE_META: Record<ViewMode, { label: string; icon: IconDefinition }> = {
  rendered: { label: 'Rendered', icon: faEye },
  source: { label: 'Source', icon: faCode },
  diff: { label: 'Diff', icon: faCodeCompare },
};

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
  private readonly panelEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private readonly cmEl: HTMLElement;
  private readonly diffEl: HTMLElement;
  private readonly menuEl: HTMLElement;
  private readonly footerEl: HTMLElement;
  private readonly viewer: EditorView;
  private readonly preview = new Compartment();
  private mode: ViewMode = 'rendered';
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
          <div class="hist-mode">
            <button class="md-tool-btn" data-act="mode" aria-haspopup="menu" aria-label="View mode"></button>
            <div class="hist-menu" role="menu" hidden>
              <button role="menuitem" data-mode="rendered">Rendered</button>
              <button role="menuitem" data-mode="source">Source</button>
              <button role="menuitem" data-mode="diff">Diff</button>
            </div>
          </div>
          <button class="md-tool-btn" data-act="restore" title="Restore this version" aria-label="Restore this version"></button>
        </header>
        <div class="hist-body">
          <ul class="hist-list"></ul>
          <div class="hist-viewer">
            <div class="hist-banner" hidden></div>
            <div class="hist-cm"></div>
            <pre class="hist-diff-pane" hidden></pre>
            <footer class="hist-footer">
              <button class="md-tool-btn" data-act="prev" title="Older version" aria-label="Older version">‹</button>
              <span class="hist-footer-meta"></span>
              <button class="md-tool-btn" data-act="next" title="Newer version" aria-label="Newer version">›</button>
            </footer>
          </div>
        </div>
      </div>`;

    this.btn('back').appendChild(faSvg(faArrowLeft));
    this.btn('restore').appendChild(faSvg(faRotateLeft));

    this.panelEl = this.el.querySelector('.hist-panel')!;
    this.listEl = this.el.querySelector('.hist-list')!;
    this.bannerEl = this.el.querySelector('.hist-banner')!;
    this.cmEl = this.el.querySelector('.hist-cm')!;
    this.diffEl = this.el.querySelector('.hist-diff-pane')!;
    this.menuEl = this.el.querySelector('.hist-menu')!;
    this.footerEl = this.el.querySelector('.hist-footer-meta')!;
    this.syncModeButton();
    this.viewer = new EditorView({
      parent: this.cmEl,
      state: EditorState.create({
        doc: '',
        extensions: [
          EditorState.readOnly.of(true),
          // Non-editable: no blinking caret, but text stays selectable/copyable.
          EditorView.editable.of(false),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage, codeLanguages: [] }),
          this.preview.of(livePreview()),
        ],
      }),
    });

    // Back: on a narrow screen showing the detail pane, step back to the list;
    // otherwise leave the history screen entirely.
    this.btn('back').addEventListener('click', () => {
      if (isNarrow() && this.panelEl.classList.contains('detail')) {
        this.panelEl.classList.remove('detail');
      } else {
        this.close();
      }
    });
    this.btn('restore').addEventListener('click', () => void this.restore());
    this.btn('prev').addEventListener('click', () => this.navigate(-1)); // older
    this.btn('next').addEventListener('click', () => this.navigate(+1)); // newer

    // Mode menu: the button toggles it; items pick a mode; outside-click closes.
    this.btn('mode').addEventListener('click', (e) => {
      e.stopPropagation();
      this.menuEl.hidden = !this.menuEl.hidden;
    });
    this.menuEl.querySelectorAll<HTMLElement>('[data-mode]').forEach((item) => {
      const mode = item.dataset.mode as ViewMode;
      item.prepend(faSvg(MODE_META[mode].icon)); // icon before the existing label
      item.addEventListener('click', () => this.setMode(mode));
    });
    document.addEventListener('click', (e) => {
      if (!this.menuEl.hidden && !this.el.querySelector('.hist-mode')!.contains(e.target as Node)) {
        this.menuEl.hidden = true;
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden) {
        if (!this.menuEl.hidden) this.menuEl.hidden = true;
        else this.close();
      }
    });

    // Refresh while open if new versions arrive (e.g. a peer edits, or offline
    // history finishes replaying).
    this.collab.history.onChange(() => { if (!this.el.hidden) this.renderList(); });

    document.body.appendChild(this.el);
  }

  open(): void {
    this.panelEl.classList.remove('detail'); // narrow screens start on the list
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
      const ico = restoredFrom
        ? `<span class="hist-restored-ico" title="Restored version">${faSvg(faRotateLeft).outerHTML}</span> `
        : '';
      li.innerHTML = `<span class="hist-when">${ico}${formatWhen(t)}</span>
        <span class="hist-meta">
          <span class="hist-who">${escapeHtml(author)}</span>
          ${added || removed ? `<span class="hist-diff"
            ><span class="hist-add">+${added}</span> <span class="hist-del">−${removed}</span></span>` : ''}
        </span>`;
      // Picking a row shows the detail pane (matters only on a narrow screen,
      // where list and content don't fit side by side).
      const pick = (): void => { this.select(i); this.panelEl.classList.add('detail'); };
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
    const from = this.rows[index]?.restoredFrom;
    this.bannerEl.hidden = !from;
    if (from) {
      this.bannerEl.textContent =
        `Restored from ${new Date(from.t).toLocaleString()} · ${from.author}`;
    }
    let selectedRow: Element | undefined;
    this.listEl.querySelectorAll('.hist-row').forEach((row, i) => {
      // rows are rendered newest-first; map display position back to row index.
      const on = this.rows.length - 1 - i === index;
      row.classList.toggle('selected', on);
      if (on) selectedRow = row;
    });
    selectedRow?.scrollIntoView({ block: 'nearest' });
    this.updateFooter();
    this.renderViewer();
  }

  // Move to the older (-1) or newer (+1) version; no-op past the ends.
  private navigate(delta: number): void {
    if (this.selected === null) return;
    const next = this.selected + delta;
    if (next >= 0 && next < this.rows.length) this.select(next);
  }

  private updateFooter(): void {
    const v = this.selected === null ? undefined : this.rows[this.selected];
    if (!v) { this.footerEl.textContent = ''; return; }
    const diff = v.added || v.removed
      ? ` · <span class="hist-add">+${v.added}</span> <span class="hist-del">−${v.removed}</span>`
      : '';
    this.footerEl.innerHTML =
      `${new Date(v.t).toLocaleString()} · ${escapeHtml(v.author)}${diff}`;
    (this.btn('prev') as HTMLButtonElement).disabled = this.selected === 0;
    (this.btn('next') as HTMLButtonElement).disabled = this.selected === this.rows.length - 1;
  }

  private setMode(mode: ViewMode): void {
    this.mode = mode;
    this.menuEl.hidden = true;
    this.syncModeButton();
    this.renderViewer();
  }

  private syncModeButton(): void {
    const { label, icon } = MODE_META[this.mode];
    this.btn('mode').replaceChildren(faSvg(icon), document.createTextNode(` ${label} ▾`));
  }

  // Show the selected version per the active mode. Diff uses a plain <pre>; the
  // other two use the read-only CodeMirror with live-preview on (Rendered) or
  // off (Source).
  private renderViewer(): void {
    const v = this.selected === null ? undefined : this.rows[this.selected];
    const text = v?.text ?? '';
    if (this.mode === 'diff') {
      this.cmEl.hidden = true;
      this.diffEl.hidden = false;
      const prev = this.selected && this.selected > 0 ? this.rows[this.selected - 1].text : '';
      this.diffEl.innerHTML = diffHtml(prev, text);
      return;
    }
    this.diffEl.hidden = true;
    this.cmEl.hidden = false;
    this.viewer.dispatch({
      changes: { from: 0, to: this.viewer.state.doc.length, insert: text },
      effects: this.preview.reconfigure(this.mode === 'rendered' ? livePreview() : []),
    });
  }

  private async restore(): Promise<void> {
    if (this.selected === null) return;
    const v = this.rows[this.selected];
    if (!v) return;
    // In-app dialog, not window.confirm() — the latter is suppressed in the iOS
    // webview (Delta Chat implements no JS dialogs), so it returned false and the
    // restore silently never happened.
    if (!(await confirmDialog('Restore this version? This replaces the current document for everyone.'))) {
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

/**
 * An in-app replacement for window.confirm() — built as a DOM overlay so it
 * works in the iOS webview (which silently suppresses native JS dialogs).
 * Resolves true on Restore, false on Cancel / backdrop / Escape.
 */
export function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="help-card confirm-card" role="dialog" aria-modal="true">
        <p class="confirm-msg"></p>
        <div class="confirm-actions">
          <button type="button" data-act="cancel">Cancel</button>
          <button type="button" class="primary" data-act="ok">Restore</button>
        </div>
      </div>`;
    overlay.querySelector('.confirm-msg')!.textContent = message;

    const done = (result: boolean): void => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') done(false);
      else if (e.key === 'Enter') done(true);
    };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
    overlay.querySelector('[data-act="cancel"]')!.addEventListener('click', () => done(false));
    overlay.querySelector('[data-act="ok"]')!.addEventListener('click', () => done(true));
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
    (overlay.querySelector('[data-act="ok"]') as HTMLButtonElement).focus();
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!
  ));
}

// Row timestamp label: within the last hour show time + a relative hint; for
// older versions on a previous day include the date so it isn't time-only.
function formatWhen(t: number): string {
  const d = new Date(t);
  const rel = relativeTime(t);
  if (rel) return `${d.toLocaleTimeString()} · ${rel}`;
  return isToday(d) ? d.toLocaleTimeString() : d.toLocaleString();
}

// Short relative label for timestamps within the last hour; null otherwise.
// ponytail: no ticking refresh — the list re-renders whenever history changes.
function relativeTime(t: number): string | null {
  const diff = Date.now() - t;
  if (diff < 0 || diff >= 3_600_000) return null;
  const mins = Math.floor(diff / 60_000);
  return mins < 1 ? 'just now' : `${mins} min ago`;
}

// Narrow screens show one pane at a time (list OR content); keep in sync with
// the .hist-body breakpoint in css/main.css.
function isNarrow(): boolean {
  return window.matchMedia('(max-width: 560px)').matches;
}

function isToday(d: Date): boolean {
  const n = new Date();
  return d.getFullYear() === n.getFullYear()
    && d.getMonth() === n.getMonth()
    && d.getDate() === n.getDate();
}

// Single-region diff: unchanged prefix/suffix kept, the middle shown as removed
// (struck) then added. Mirrors history.ts's char-count approximation — exact for
// one edit region, a coarse single block when a batch touched two far-apart spots.
function diffHtml(prev: string, next: string): string {
  let p = 0;
  const min = Math.min(prev.length, next.length);
  while (p < min && prev[p] === next[p]) p++;
  let s = 0;
  while (s < min - p && prev[prev.length - 1 - s] === next[next.length - 1 - s]) s++;
  const removed = prev.slice(p, prev.length - s);
  const added = next.slice(p, next.length - s);
  return escapeHtml(next.slice(0, p))
    + (removed ? `<del>${escapeHtml(removed)}</del>` : '')
    + (added ? `<ins>${escapeHtml(added)}</ins>` : '')
    + escapeHtml(next.slice(next.length - s));
}
