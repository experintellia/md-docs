import { placeholder } from '@codemirror/view';
import { createEditor } from './editor';
import { createCollab } from './collab';
import { mountToolbar } from './ui/toolbar';

// Entry point. Phase 2: a Yjs-backed document synced to chat peers via the
// webxdc persistent channel, bound to CodeMirror with undo + awareness.

function main(): void {
  const editorEl = document.querySelector<HTMLElement>('#editor');
  const toolbarEl = document.querySelector<HTMLElement>('#toolbar');
  const statusEl = document.querySelector<HTMLElement>('#status');
  if (!editorEl) throw new Error('#editor element not found');

  // webxdc.js is injected by the messenger / webxdc-dev, not by plain vite — so
  // it's absent when opening the dev server directly (e.g. :3000). Fall back to
  // a local-only editor in that case; collaboration lights up when the app is
  // opened in webxdc-dev (:7001/:7002) or a real messenger.
  const collab = typeof window.webxdc === 'undefined' ? undefined : createCollab();
  if (!collab) {
    console.warn(
      'webxdc.js not found — running locally without sync. Open via webxdc-dev ' +
        '(npm start, then the :7001/:7002 peer URLs) to collaborate.',
    );
  }

  // Content lives in the shared ytext (when collaborating), so the editor starts
  // empty; the ghost text is a native CM6 placeholder — never written into the
  // doc, so no distributed-seeding race between peers.
  const view = createEditor(
    editorEl,
    '',
    [placeholder('# Start writing…')],
    collab,
  );
  if (toolbarEl) mountToolbar(toolbarEl, view);

  if (statusEl && collab) {
    collab.provider.on('sync', ({ hasQueued }) => {
      statusEl.textContent = hasQueued ? 'editing…' : 'saved';
    });
  }
}

main();
