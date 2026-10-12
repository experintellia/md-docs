import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

export { expect };

/**
 * Stand in for iOS jetsam: SIGKILL any WebKit content process that outgrows
 * `budgetMB`. iOS has no swap and kills a WebContent process the moment it
 * goes over its memory budget; macOS swaps instead, so a page that allocates
 * without bound grinds on for minutes rather than dying. Only Playwright's own
 * WebKit is touched — never Safari or another app's. Returns a stop function.
 */
export function jetsam(budgetMB = 1024): () => void {
  const seen = new Set<string>();
  const timer = setInterval(() => {
    let ps: string;
    try {
      ps = execFileSync('ps', ['-axo', 'pid=,rss=,command='], { encoding: 'utf8' });
    } catch {
      return; // a failed listing just skips this tick
    }
    for (const line of ps.split('\n')) {
      const [, pid, rss, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/) ?? [];
      // WebContent on macOS, WebKitWebProcess on Linux.
      if (!command || !/ms-playwright\/webkit-\S*(WebContent|WebKitWebProcess)/.test(command)) continue;
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
// reload replays the log like a relaunch does. `patch` runs right after it,
// to bend the mock towards a particular messenger; it replaces any mock already
// served to the context.
//
// Those pages share one origin, and so one localStorage, where real peers are
// separate devices. The app's own keys (md-docs-*) are kept apart per peer;
// the mock's log stays shared, as the chat is.
const MOCK_WEBXDC = fileURLToPath(
  new URL('../node_modules/@webxdc/vite-plugins/src/webxdc.js', import.meta.url),
);
const PER_DEVICE_STORAGE = `{
  const local = (key) => String(key).startsWith('md-docs-') ? window.webxdc.selfAddr + '/' + key : key;
  for (const name of ['getItem', 'setItem', 'removeItem']) {
    const real = Storage.prototype[name];
    Storage.prototype[name] = function (key, ...rest) { return real.call(this, local(key), ...rest); };
  }
}`;
export async function serveMockWebxdc(context: BrowserContext, patch = ''): Promise<void> {
  const body = `${readFileSync(MOCK_WEBXDC, 'utf8')}\n${PER_DEVICE_STORAGE}\n${patch}`;
  await context.unroute('**/webxdc.js');
  await context.route('**/webxdc.js', (route) => route.fulfill({ body, contentType: 'text/javascript' }));
}

/** Tap on a phone, click elsewhere: the toolbar and checkboxes act on the
 *  mousedown a tap synthesizes, which is where iOS differs. */
export const press = (target: Locator, isMobile: boolean): Promise<void> =>
  isMobile ? target.tap() : target.click();

/** The mock reads the peer's identity from the URL hash. */
export const peer = (name: string): string => `/#name=${name}&addr=${name}@local.host`;

/** localStorage key the mock keeps the persistent update log under. */
export const UPDATES_KEY = '__xdcUpdatesKey__';

/** The chat log so far, one entry per update: who sent it, and what it claims. */
export const chat = (page: Page): Promise<string[]> => page.evaluate((key) =>
  (JSON.parse(localStorage.getItem(key) ?? '[]') as
    { _sender: string; info?: string; summary?: string; payload: { resent?: boolean } }[])
    .map((u) => [u._sender.split('@')[0], u.payload.resent && 're-sent', u.info && 'info', u.summary && 'summary']
      .filter(Boolean).join(' ')), UPDATES_KEY);

export const editor = (page: Page): Locator => page.locator('#editor .cm-content');

/** Open the app as `name`, or at `url` (a path with the peer in its hash). */
export async function open(page: Page, name = 'alice', url = peer(name)): Promise<void> {
  await page.goto(url);
  await expect(page.locator('.cm-editor')).toBeVisible();
}

export async function write(page: Page, text: string): Promise<void> {
  await editor(page).click();
  await page.keyboard.insertText(text);
}

// The mock connects realtime 500 ms after joinRealtimeChannel, and a frame sent
// before then is dropped. A second 500 ms timer fires after the mock's own.
export const REALTIME_UP = `{
  const join = window.webxdc.joinRealtimeChannel;
  window.webxdc.joinRealtimeChannel = (...args) => {
    const channel = join(...args);
    setTimeout(() => (window.realtimeUp = true), 500);
    return channel;
  };
}`;
export const realtimeUp = (page: Page): Promise<unknown> => page.waitForFunction(() => 'realtimeUp' in window);

export const test = base.extend({
  context: async ({ context }, use) => {
    await serveMockWebxdc(context);
    await use(context);
  },
});
