import { createEditor } from './editor';
import { mountToolbar } from './ui/toolbar';

// Entry point. Phase 0: mount a plain CodeMirror markdown editor.
// Phase 1 wires in the live-preview decorations + editing toolbar, and
// Phase 2 replaces the seed document with a Yjs-backed, chat-synced one.

const STARTER = `# MD-Docs

A collaborative **markdown** editor for webxdc.

- [ ] write something
- [x] try the toolbar

> Live preview and collaboration are coming together here.
`;

function main(): void {
  const editorEl = document.querySelector<HTMLElement>('#editor');
  const toolbarEl = document.querySelector<HTMLElement>('#toolbar');
  if (!editorEl) throw new Error('#editor element not found');
  const view = createEditor(editorEl, STARTER);
  if (toolbarEl) mountToolbar(toolbarEl, view);
}

main();
