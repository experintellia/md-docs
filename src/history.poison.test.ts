import { test, after, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as Y from 'yjs';

GlobalRegistrator.register();
const { setupHistory } = await import('./history.ts');
after(() => GlobalRegistrator.unregister());

// The poison-batch guard. Applying a batch can kill the PROCESS rather than
// throw — yjs sizes an array from an unvalidated varuint on the wire, so a
// corrupt one ends in a V8 heap abort that no try/catch can catch — and the
// channel replays its whole log on every launch, so one such batch would kill
// the app on open forever. The guard cannot inspect a batch (decoding it is
// what kills us), so it notes the batch it is about to decode and quarantines
// whatever note survives a launch. These tests drive that state machine; the
// "crash" is simulated by not reaching the line that clears the note, which is
// exactly what a heap abort does.

const POISON_KEY = 'md-docs-poison-batches'; // must match history.ts

interface Harness {
  real: typeof window.webxdc;
  fire: (payload: Record<string, unknown>) => void;
}

function fakeWebxdc(): Harness {
  let listener: ((u: { payload: Record<string, unknown> }) => void) | undefined;
  const real = {
    selfName: 'Alice',
    setUpdateListener: (cb: (u: { payload: Record<string, unknown> }) => void) => {
      listener = cb;
      return Promise.resolve();
    },
    sendUpdate: () => {},
  } as unknown as typeof window.webxdc;
  return { real, fire: (payload) => listener!({ payload }) };
}

function blobOf(text: string): string {
  const doc = new Y.Doc();
  doc.getText('codemirror').insert(0, text);
  return Buffer.from(Y.encodeStateAsUpdateV2(doc)).toString('base64');
}

const poison = (): { pending: string | null; bad: string[] } =>
  JSON.parse(localStorage.getItem(POISON_KEY) ?? '{"pending":null,"bad":[]}');

beforeEach(() => localStorage.clear());

test('a batch is noted before it is decoded and the note cleared after', () => {
  const { real, fire } = fakeWebxdc();
  const history = setupHistory(real);
  let noteDuringDecode: string | null = null;
  // Runs where the decoder would: whatever is written down here is what a heap
  // abort mid-decode would leave behind.
  history.webxdc.setUpdateListener(() => { noteDuringDecode = poison().pending; });

  fire({ serializedYjsUpdate: blobOf('hi'), t: 1, author: 'Alice' });

  assert.ok(noteDuringDecode, 'the batch was written down before being decoded');
  assert.equal(poison().pending, null, 'and the note is cleared once it survives');
  assert.deepEqual(poison().bad, [], 'nothing quarantined on a clean run');
});

test('a note surviving a launch means that batch killed us: it is quarantined', () => {
  const blob = blobOf('poison');
  // Previous run died mid-decode, so its note was never cleared.
  const { real, fire } = fakeWebxdc();
  const first = setupHistory(real);
  first.webxdc.setUpdateListener(() => { throw new Error('simulated process death'); });
  assert.throws(() => fire({ serializedYjsUpdate: blob, t: 1, author: 'Alice' }));
  const stranded = poison().pending;
  assert.ok(stranded, 'the note outlived the decode');

  // Next launch reads the stranded note.
  const next = fakeWebxdc();
  const history = setupHistory(next.real);
  assert.deepEqual(poison().bad, [stranded], 'quarantined on startup');
  assert.equal(poison().pending, null, 'and the note is consumed');

  // The channel replays the same batch; it must not reach a decoder again.
  let decoded = 0;
  history.webxdc.setUpdateListener(() => { decoded++; });
  next.fire({ serializedYjsUpdate: blob, t: 1, author: 'Alice' });
  assert.equal(decoded, 0, 'the poisoned batch is never handed to the provider again');
  assert.deepEqual(history.versions(), [], 'nor recorded in the timeline');
});

test('quarantining one batch does not block the rest of the log', () => {
  const bad = blobOf('poison');
  const good = blobOf('real edit');
  localStorage.setItem(POISON_KEY, JSON.stringify({ pending: null, bad: [] }));

  // Die on the bad batch.
  const first = fakeWebxdc();
  const h1 = setupHistory(first.real);
  h1.webxdc.setUpdateListener(() => { throw new Error('simulated process death'); });
  assert.throws(() => first.fire({ serializedYjsUpdate: bad }));

  // Relaunch: the log replays both batches, and the good one still applies.
  const second = fakeWebxdc();
  const h2 = setupHistory(second.real);
  const seen: string[] = [];
  h2.webxdc.setUpdateListener((u) => {
    seen.push((u.payload as { serializedYjsUpdate: string }).serializedYjsUpdate);
  });
  second.fire({ serializedYjsUpdate: bad });
  second.fire({ serializedYjsUpdate: good, t: 2, author: 'Bob' });

  assert.deepEqual(seen, [good], 'only the good batch reaches the provider');
  assert.deepEqual(h2.versions().map((v) => v.text), ['real edit']);
});

test('the guard degrades to off when localStorage is unavailable', () => {
  // Some webviews throw on any storage access (private mode). Startup and
  // update delivery must not depend on the guard working.
  const store = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() { throw new Error('storage disabled'); },
  });
  try {
    const { real, fire } = fakeWebxdc();
    const history = setupHistory(real);
    let delivered = 0;
    history.webxdc.setUpdateListener(() => { delivered++; });
    assert.doesNotThrow(() => fire({ serializedYjsUpdate: blobOf('hi'), t: 1, author: 'A' }));
    assert.equal(delivered, 1, 'updates still flow with no storage to note them in');
  } finally {
    if (store) Object.defineProperty(window, 'localStorage', store);
  }
});

test('a corrupt poison note is ignored rather than breaking startup', () => {
  localStorage.setItem(POISON_KEY, 'not json at all');
  const { real, fire } = fakeWebxdc();
  const history = setupHistory(real);
  let delivered = 0;
  history.webxdc.setUpdateListener(() => { delivered++; });
  assert.doesNotThrow(() => fire({ serializedYjsUpdate: blobOf('hi'), t: 1, author: 'A' }));
  assert.equal(delivered, 1);
});
