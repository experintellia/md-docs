/**
 * This viewer's read-mode choice, kept outside the document.
 *
 * The choice travels as a silent status update (history.sendSilent): no info line
 * and no summary in the chat, and nothing in the Yjs updates, so the document's
 * own updates do not grow. The channel replays every stored update on launch; the
 * last one naming this viewer's address is the choice. The channel delivers
 * updates in one order for every device, so concurrent toggles settle the same
 * way everywhere.
 *
 * Sends are debounced: a burst of taps sends only its last value, and flush()
 * sends a pending one at once (on hide, so a tap just before leaving is kept).
 * Until the startup replay has ended nothing is applied, so the page never flips
 * through past choices on the way to the stored one.
 */
export interface ReadModeLink {
  /** This viewer's address; the choice is stored and read under it. */
  me: string;
  /** Send a silent status update. */
  send(payload: Record<string, unknown>): void;
  /** Every silent update, in channel order, replays included. */
  onMessage(cb: (payload: Record<string, unknown>) => void): void;
  /** Resolves once the channel's startup replay has been delivered. */
  replayed: Promise<void>;
}

export interface ReadModePref {
  get(): boolean;
  /** Show the choice now, and send it once the taps stop. */
  set(on: boolean): void;
  /** Runs after the shown choice changes, from a tap or from another device. */
  onChange(cb: () => void): void;
  /** Send a pending choice now rather than when its debounce runs out. */
  flush(): void;
}

// ponytail: fixed debounce, no tuning knob; a second is about one deliberate tap.
const DEBOUNCE_MS = 1000;

export function createReadModePref(link: ReadModeLink, debounceMs = DEBOUNCE_MS): ReadModePref {
  let shown = false; // what the page shows
  let stored = false; // the last choice in the log, or the one we sent
  let replaying = true; // nothing is applied until the startup replay ends
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners: Array<() => void> = [];

  const apply = (on: boolean): void => {
    if (shown === on) return;
    shown = on;
    for (const cb of listeners) cb();
  };

  const send = (): void => {
    clearTimeout(timer);
    timer = undefined;
    if (shown === stored) return;
    stored = shown;
    link.send({ readMode: { addr: link.me, on: shown } });
  };

  link.onMessage((payload) => {
    const r = payload.readMode as { addr?: unknown; on?: unknown } | undefined;
    if (!r || typeof r !== 'object' || r.addr !== link.me || typeof r.on !== 'boolean') return;
    stored = r.on;
    // A choice still waiting in the debounce is newer than this one: it wins
    // when it is sent, and it is not overwritten here.
    if (!replaying && timer === undefined) apply(r.on);
  });

  const replayDone = (): void => {
    replaying = false;
    if (timer === undefined) apply(stored);
  };
  link.replayed.then(replayDone, replayDone);

  return {
    get: () => shown,
    set: (on) => {
      apply(on);
      clearTimeout(timer);
      timer = shown === stored ? undefined : setTimeout(send, debounceMs);
    },
    onChange: (cb) => { listeners.push(cb); },
    flush: () => {
      if (timer !== undefined) send();
    },
  };
}
