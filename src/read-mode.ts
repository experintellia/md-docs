/**
 * This viewer's read-mode choice, kept outside the document.
 *
 * The choice travels as a silent status update (history.sendSilent): no info line
 * and no summary in the chat, and nothing in the Yjs updates, so the document's
 * own updates do not grow. The channel replays every stored update on launch.
 *
 * webxdc does not deliver updates in one order for every device, and device
 * clocks can be wrong, so neither "the last one received" nor a timestamp can
 * pick the choice. Each update carries a counter one above the highest it has
 * seen (a Lamport clock), plus which app start made it, to break a tie. Every
 * device keeps the highest it has seen, so once they have all seen the same
 * updates they agree, whatever order those arrived in. A tap made after seeing a
 * choice always outranks it. Two made offline without seeing each other are
 * settled by the tie-break: arbitrary, but the same on every device.
 *
 * Sends are debounced: a burst of taps sends only its last value, and flush()
 * sends a pending one at once (on hide or close, so a tap just before leaving is
 * kept). A send is async, and iOS can freeze the page before it reaches the
 * messenger, so with `unsent` each choice is also kept synchronously until the
 * log shows it (or something newer) and sent again after the next replay.
 * Until the startup replay has ended nothing is applied, so the page never
 * flips through past choices on the way to the stored one.
 */
export interface ReadModeLink {
  /** This viewer's address; the choice is stored and read under it. */
  me: string;
  /** Send a silent status update. */
  send(payload: Record<string, unknown>): void;
  /** Every silent update, replays included. */
  onMessage(cb: (payload: Record<string, unknown>) => void): void;
  /** Settles once the channel's startup replay has been delivered. */
  replayed: Promise<void>;
  /** Optional synchronous store for the last choice sent, until the log has it. */
  unsent?: {
    load(): unknown;
    save(payload: Record<string, unknown> | null): void;
  };
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

/** A choice's Lamport counter, and the app start that made it: compared in that order. */
type Stamp = [n: number, dev: string];
const newer = (a: Stamp, b: Stamp): boolean => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);

/** This viewer's choice in `payload`, or null if it carries none. A counter that
 *  is not a safe positive integer is refused: at 2^53 or Infinity, n + 1 === n
 *  and every later tap would tie with it. */
function parse(payload: unknown, me: string): { on: boolean; at: Stamp } | null {
  const r = (payload as { readMode?: unknown } | null)?.readMode as
    { addr?: unknown; on?: unknown; n?: unknown; dev?: unknown } | undefined;
  if (!r || typeof r !== 'object' || r.addr !== me || typeof r.on !== 'boolean') return null;
  if (!Number.isSafeInteger(r.n) || (r.n as number) < 1 || typeof r.dev !== 'string') return null;
  return { on: r.on, at: [r.n as number, r.dev] };
}

export function createReadModePref(link: ReadModeLink, debounceMs = DEBOUNCE_MS): ReadModePref {
  const dev = Math.random().toString(36).slice(2);
  let shown = false; // what the page shows
  let stored = false; // the newest choice seen, ours included
  let storedAt: Stamp = [0, ''];
  let replaying = true; // nothing is applied until the startup replay ends
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners: Array<() => void> = [];
  // Our last sent choice while the log may not have it yet (see `unsent`).
  let kept: { payload: Record<string, unknown>; at: Stamp } | null = null;
  const loaded = link.unsent?.load();
  const keptChoice = parse(loaded, link.me);
  if (keptChoice) kept = { payload: loaded as Record<string, unknown>, at: keptChoice.at };
  else if (loaded != null) link.unsent?.save(null);
  const forget = (): void => {
    kept = null;
    link.unsent?.save(null);
  };

  const apply = (on: boolean): void => {
    if (shown === on) return;
    shown = on;
    for (const cb of listeners) cb();
  };

  const send = (): void => {
    clearTimeout(timer);
    timer = undefined;
    if (shown === stored) return;
    const n = storedAt[0] + 1;
    stored = shown;
    storedAt = [n, dev];
    const payload = { readMode: { addr: link.me, on: shown, n, dev } };
    kept = { payload, at: storedAt };
    link.unsent?.save(payload); // before the send, which may never land
    link.send(payload);
  };

  link.onMessage((payload) => {
    const choice = parse(payload, link.me);
    if (!choice) return;
    const { at } = choice;
    // The log has our kept choice, or one that outranks it: nothing to resend.
    if (kept && !newer(kept.at, at)) forget();
    if (!newer(at, storedAt)) return; // older than what we have, or our own echo
    stored = choice.on;
    storedAt = at;
    // A choice still waiting in the debounce is newer than this one: it wins
    // when it is sent, and it is not overwritten here.
    if (!replaying && timer === undefined) apply(choice.on);
  });

  // Runs when the replay ends, or when collab's 10 s bound gives up waiting for
  // it. In that second case the rest of the log arrives live and each newer
  // choice in it is applied as it comes: the page can switch a few times before
  // it settles, and a tap made meanwhile can still be outranked by a stored
  // choice that arrives later. Every device ends on the same choice regardless.
  const replayDone = (): void => {
    replaying = false;
    if (kept) {
      // Still kept after a full replay: the send never reached the log. Send
      // it again, unless something newer has been chosen since.
      if (newer(kept.at, storedAt)) {
        stored = (kept.payload.readMode as { on: boolean }).on;
        storedAt = kept.at;
        link.send(kept.payload);
      } else {
        forget();
      }
    }
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
