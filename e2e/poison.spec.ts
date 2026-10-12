import * as Y from 'yjs';
import { test, expect, jetsam, serveMockWebxdc, UPDATES_KEY } from './fixtures';
import { errors, type BrowserType } from '@playwright/test';

// The poison-batch guard from #18, end to end, with the real 91-byte batch from
// #19: decoding it makes the engine run out of heap, which aborts the process
// rather than throwing. The guard notes each batch in localStorage before
// decoding it and quarantines whatever note survives a launch, so the question
// #22 asks is purely whether that note reaches disk before the process dies.
//
// Each "launch" is a fresh browser on a persistent profile, so storage comes
// back from disk exactly as it would after the messenger restarts the app.

// A valid updateV2 with its struct count overwritten (see #19).
const POISON = Uint8Array.from([
  0, 0, 5, 138, 3, 229, 1, 2, 2, 2, 10, 1, 0, 7, 68, 0, 4, 0, 129, 0, 132, 54, 49, 112, 101, 101, 114,
  32, 99, 111, 100, 101, 109, 105, 114, 114, 111, 114, 104, 101, 111, 114, 108, 100, 44, 32, 97,
  32, 115, 111, 109, 101, 119, 104, 97, 116, 32, 108, 111, 110, 103, 101, 114, 32, 100, 111, 99,
  117, 109, 101, 110, 116, 5, 10, 2, 32, 1, 1, 0, 1, 5, 2, 255, 255, 255, 255, 1, 101, 1, 2, 4,
]);

const TEXT = 'the document outlived the poison batch';

const doc = new Y.Doc();
doc.getText('codemirror').insert(0, TEXT);
// A good batch, then the poisoned one, as the channel would replay them.
const LOG = JSON.stringify([Y.encodeStateAsUpdateV2(doc), POISON].map((bytes, i) => ({
  serial: i + 1,
  payload: { serializedYjsUpdate: Buffer.from(bytes).toString('base64') },
})));

type Outcome = 'opened' | 'aborted' | 'hung';

/** Start the app on `profile` and report how the launch ended. */
async function launch(browserType: BrowserType, profile: string, args: string[] = []): Promise<Outcome> {
  const { baseURL, launchOptions } = test.info().project.use;
  const context = await browserType.launchPersistentContext(profile, {
    ...launchOptions,
    baseURL,
    args: [...(launchOptions?.args ?? []), ...args],
  });
  await serveMockWebxdc(context);
  // The log belongs to the messenger and outlives any crash of ours, but the
  // mock keeps it in the app's own localStorage: put it back if a crash took
  // it, so every launch replays the poison exactly like a real relaunch.
  await context.addInitScript(([key, log]) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, log);
  }, [UPDATES_KEY, LOG]);

  const started = Date.now();
  const page = context.pages()[0] ?? await context.newPage();
  // A death ends the wait: not every engine fails a pending waitFor on it.
  const died = new Promise<Outcome>((resolve) => {
    context.on('close', () => resolve('aborted')); // single-process: the whole browser died
    page.on('crash', () => resolve('aborted')); // multi-process: just the renderer
  });
  await page.goto('/', { waitUntil: 'commit' }).catch(() => {});
  const outcome = await Promise.race([
    // Only a timeout means nothing happened; any other failure is the target
    // dying, whichever of the two the engine reports first.
    page.getByText(TEXT).waitFor({ timeout: 120_000 }).then(
      (): Outcome => 'opened',
      (err): Outcome => (err instanceof errors.TimeoutError ? 'hung' : 'aborted'),
    ),
    died,
  ]);
  console.log(`${browserType.name()} launch ${outcome} after ${((Date.now() - started) / 1000).toFixed(1)}s`);
  // A graceful close lets a surviving browser process flush storage, as the
  // messenger's would on its own a few seconds later.
  await context.close().catch(() => {});
  return outcome;
}

test.describe('poison batch (#19, #22)', () => {
  // Emulated phones run the same engine as the desktop projects.
  test.skip(({ isMobile }) => isMobile, 'engine-level, covered by the desktop projects');
  test.setTimeout(300_000);

  test('one abort at most, then the batch is quarantined', async ({ playwright, browserName }, info) => {
    const browserType = playwright[browserName];
    // Out-of-process renderers: Electron and multiprocess Android WebView
    // (Chromium), iOS WKWebView (WebKit's WebContent process). The browser side
    // survives the abort and commits the note.
    // A small heap makes V8 abort sooner; JavaScriptCore has no such cap, and
    // macOS swaps where iOS would kill the page, so jetsam does it here.
    const args = browserName === 'chromium' ? ['--js-flags=--max-old-space-size=32'] : [];
    const stop = browserName === 'webkit' ? jetsam() : () => {};
    const profile = info.outputPath('profile');

    try {
      const first = await launch(browserType, profile, args);
      // Which way the engine went is the finding: an abort exercises the guard,
      // a catchable out-of-memory error never needs it.
      info.annotations.push({ type: 'first launch', description: first });
      expect(first, 'the poison batch neither aborted the app nor let it open').not.toBe('hung');
      if (first === 'aborted') {
        expect(await launch(browserType, profile, args), 'the relaunch quarantined the batch').toBe('opened');
      }
    } finally {
      stop();
    }
  });

  test('single-process engine: an abort inside the storage commit window loses the note', async (
    { playwright, browserName },
    info,
  ) => {
    test.skip(browserName !== 'chromium', 'only Chromium can be forced single-process');
    const browserType = playwright.chromium;
    // The case #22 could not verify off-device. Chromium commits localStorage
    // about 5s after a write (measured: a note survives an abort 5.3s after it
    // was written, not one 4.7s after); out of process, the browser side
    // commits it anyway, but here it dies with the renderer. With a 32 MB heap
    // the abort lands well under a second after the note locally (slower on
    // CI runners; the log prints it), so the note is lost, the relaunch
    // replays the poison again, and the document stays bricked. Given a big
    // enough heap (or a slow enough device) to take longer than the window, the
    // note survives and the guard works — it is a race against the commit.
    //
    // This pins the current behaviour. When it starts failing because the
    // relaunch opens, the guard has been made to hold here too: flip the
    // expectation and close #22.
    const args = ['--single-process', '--js-flags=--max-old-space-size=32'];
    const profile = info.outputPath('profile');

    expect(await launch(browserType, profile, args)).toBe('aborted');
    // If this flips, first check the logged abort time: the premise is an
    // abort well inside the ~5s window, and a slow enough runner breaks it.
    expect(await launch(browserType, profile, args), 'the note did not survive, so neither did the relaunch')
      .toBe('aborted');
  });
});
