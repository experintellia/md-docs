/**
 * Make `overlay` (a child of <body>) modal: everything else in <body> goes
 * inert, so Tab and a screen reader stay inside it, and focus moves to
 * `focus`. The returned function undoes both, putting focus back where it was
 * (unless that was the editor, see below).
 * Nests: a confirm over the history screen leaves #app inert when it closes.
 */
export function trapFocus(overlay: HTMLElement, focus: HTMLElement): () => void {
  const back = document.activeElement as HTMLElement | null;
  const frozen = [...document.body.children].filter(
    (el): el is HTMLElement => el !== overlay && el instanceof HTMLElement && !el.inert,
  );
  for (const el of frozen) el.inert = true;
  focus.focus();
  return () => {
    for (const el of frozen) el.inert = false;
    // Not back into the editor: that is where a tap left focus on a phone
    // (taps don't focus buttons there), and refocusing it from the close tap
    // would pop the on-screen keyboard up again.
    if (!back?.isContentEditable) back?.focus();
  };
}
