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

  const collab = createCollab();
  // Content lives in the shared ytext, so the editor starts empty; the ghost
  // text is a native CM6 placeholder — never written into the shared doc, so no
  // distributed-seeding race between peers.
  const view = createEditor(
    editorEl,
    '',
    [placeholder('# Start writing…')],
    collab,
  );
  if (toolbarEl) mountToolbar(toolbarEl, view);

  if (statusEl) {
    collab.provider.on('sync', ({ hasQueued }) => {
      statusEl.textContent = hasQueued ? 'editing…' : 'saved';
    });
  }
}

main();
