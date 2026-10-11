import { test as base, type BrowserContext } from '@playwright/test';

export { expect } from '@playwright/test';

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
