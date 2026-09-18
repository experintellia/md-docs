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

// A process abort leaves the note behind because it never unwinds. Nothing in
// a test can abort the process and keep running, so the stranded note is
// written directly — that is precisely the state an abort leaves on disk.
function strand(id: string): void {
  localStorage.setItem(POISON_KEY, JSON.stringify({ pending: id, bad: [] }));
}

function fingerprintOf(blob: string): string {
  // Round-trip through the shim: whatever it writes down while decoding is the
  // id an abort would strand, so the tests never hard-code the hash format.
  localStorage.clear();
  const { real, fire } = fakeWebxdc();
  const history = setupHistory(real);
  let seen: string | null = null;
  history.webxdc.setUpdateListener(() => { seen = poison().pending; });
  fire({ serializedYjsUpdate: blob });
  localStorage.clear();
  return seen!;
}

test('a note surviving a launch means that batch aborted us: it is quarantined', () => {
  const blob = blobOf('poison');
  strand(fingerprintOf(blob));

  const { real, fire } = fakeWebxdc();
  const history = setupHistory(real);
  assert.deepEqual(poison().bad, [fingerprintOf(blob)], 'quarantined on startup');
  assert.equal(poison().pending, null, 'and the note is consumed');

  // The channel replays the same batch; it must not reach a decoder again.
  let decoded = 0;
  history.webxdc.setUpdateListener(() => { decoded++; });
  fire({ serializedYjsUpdate: blob, t: 1, author: 'Alice' });
  assert.equal(decoded, 0, 'the poisoned batch is never handed to the provider again');
  assert.deepEqual(history.versions(), [], 'nor recorded in the timeline');
});

test('quarantining one batch does not block the rest of the log', () => {
  const bad = blobOf('poison');
  const good = blobOf('real edit');
  strand(fingerprintOf(bad));

  const { real, fire } = fakeWebxdc();
  const history = setupHistory(real);
  const seen: string[] = [];
  history.webxdc.setUpdateListener((u) => {
    seen.push((u.payload as { serializedYjsUpdate: string }).serializedYjsUpdate);
  });
  fire({ serializedYjsUpdate: bad });
  fire({ serializedYjsUpdate: good, t: 2, author: 'Bob' });

  assert.deepEqual(seen, [good], 'only the good batch reaches the provider');
  assert.deepEqual(history.versions().map((v) => v.text), ['real edit']);
});

test('a batch that merely THROWS is not quarantined', () => {
  // The note names a batch that aborts the process. An exception means the
  // opposite — we are still running. Quarantining on a throw would drop a
  // legitimate batch for good on this device: yjs runs observers inside
  // applyUpdateV2 *after* mutating the doc, so a bug in any downstream
  // listener (y-codemirror's sync observer, awareness, ...) would strand the
  // note on a batch that applied perfectly.
  const blob = blobOf('applied fine');
  const { real, fire } = fakeWebxdc();
  const history = setupHistory(real);
  history.webxdc.setUpdateListener(() => { throw new Error('observer blew up'); });

  assert.doesNotThrow(
    () => fire({ serializedYjsUpdate: blob, t: 1, author: 'Alice' }),
    'the throw is contained, so the rest of the replayed log still arrives',
  );
  assert.equal(poison().pending, null, 'no note left behind');
  assert.deepEqual(poison().bad, [], 'and nothing quarantined');

  // The decisive part: the next launch must still accept that batch.
  const next = fakeWebxdc();
  const after = setupHistory(next.real);
  let decoded = 0;
  after.webxdc.setUpdateListener(() => { decoded++; });
  next.fire({ serializedYjsUpdate: blob, t: 1, author: 'Alice' });
  assert.equal(decoded, 1, 'the batch is still delivered on the next launch');
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
