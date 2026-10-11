import { execFileSync } from 'node:child_process';
import { test as base, type BrowserContext } from '@playwright/test';

export { expect } from '@playwright/test';

/**
 * Stand in for iOS jetsam: SIGKILL any WebKit content process that outgrows
 * `budgetMB`. iOS has no swap and kills a WebContent process the moment it
 * goes over its memory budget; macOS swaps instead, so a page that allocates
 * without bound grinds on for minutes rather than dying. Returns a stop
 * function.
 */
export function jetsam(budgetMB = 1024): () => void {
  const seen = new Set<string>();
  const timer = setInterval(() => {
    const ps = execFileSync('ps', ['-axo', 'pid=,rss=,command='], { encoding: 'utf8' });
    for (const line of ps.split('\n')) {
      const [, pid, rss, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/) ?? [];
      // WebContent on macOS, WebKitWebProcess on Linux.
      if (!command || !/WebContent|WebKitWebProcess/.test(command)) continue;
      if (!seen.has(pid)) {
        seen.add(pid);
        console.log(`jetsam: watching ${pid} ${command}`);
      }
      if (Number(rss) > budgetMB * 1024) {
        console.log(`jetsam: killing ${pid} at ${Math.round(Number(rss) / 1024)} MB`);
        try {
          process.kill(Number(pid), 'SIGKILL');
        } catch {
          // Already gone.
        }
      }
    }
  }, 250);
  return () => clearInterval(timer);
}

// The built index.html loads ./webxdc.js, which a real messenger injects. Serve
// the @webxdc/vite-plugins mock in its place (the one `npm run serve:app` uses):
// it keeps the update log in localStorage and relays it between tabs with
// `storage` events, so every page in one context is a peer on one chat, and a
// reload replays the log like a relaunch does.
export async function serveMockWebxdc(context: BrowserContext): Promise<void> {
  await context.route('**/webxdc.js', (route) =>
    route.fulfill({ path: 'node_modules/@webxdc/vite-plugins/src/webxdc.js' }));
}

/** The mock reads the peer's identity from the URL hash. */
export const peer = (name: string): string => `/#name=${name}&addr=${name}@local.host`;

/** localStorage key the mock keeps the persistent update log under. */
export const UPDATES_KEY = '__xdcUpdatesKey__';

export const test = base.extend({
  context: async ({ context }, use) => {
    await serveMockWebxdc(context);
    await use(context);
  },
});
