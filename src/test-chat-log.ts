import type { ReadModeLink } from './read-mode.ts';

/**
 * Stand-in for the chat's status-update log, for tests. Every silent update is
 * stored in order. A device that joins is replayed the stored updates first,
 * then gets the live ones, and it hears its own sends back, as webxdc does.
 */
export interface ChatLog {
  /** Every stored silent update, in order. */
  stored: Record<string, unknown>[];
  /** A device's link to the log, as createReadModePref expects it. */
  link(me: string): ReadModeLink;
}

export function createChatLog(): ChatLog {
  const stored: Record<string, unknown>[] = [];
  const live: Array<(payload: Record<string, unknown>) => void> = [];
  return {
    stored,
    link: (me) => ({
      me,
      send: (payload) => {
        stored.push(payload);
        for (const cb of [...live]) cb(payload);
      },
      onMessage: (cb) => {
        for (const payload of [...stored]) cb(payload);
        live.push(cb);
      },
      replayed: Promise.resolve(),
    }),
  };
}
