import { test, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();
const { confirmDialog } = await import('./history-view.ts');
after(() => GlobalRegistrator.unregister());

// The restore confirm used window.confirm(), which the iOS webview suppresses
// (returns false, no dialog). confirmDialog is the in-app replacement: it must
// actually render a dialog and resolve to the user's choice.

test('confirmDialog renders an in-app dialog and resolves true on confirm', async () => {
  const choice = confirmDialog('Restore this version?');
  const overlay = document.querySelector('#confirm-overlay');
  assert.ok(overlay, 'dialog is in the DOM (unlike a suppressed window.confirm)');
  assert.equal(overlay!.querySelector('.confirm-msg')!.textContent, 'Restore this version?');

  (overlay!.querySelector('[data-act="ok"]') as HTMLButtonElement).click();
  assert.equal(await choice, true);
  assert.equal(document.querySelector('#confirm-overlay'), null, 'dialog removed after choosing');
});

test('confirmDialog resolves false on Cancel', async () => {
  const choice = confirmDialog('Restore this version?');
  (document.querySelector('#confirm-overlay [data-act="cancel"]') as HTMLButtonElement).click();
  assert.equal(await choice, false);
});

test('confirmDialog resolves false on Escape', async () => {
  const choice = confirmDialog('Restore this version?');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(await choice, false);
});

test('confirmDialog resolves true on Enter and false on a backdrop click', async () => {
  const byEnter = confirmDialog('Restore this version?');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  assert.equal(await byEnter, true);

  const byBackdrop = confirmDialog('Restore this version?');
  const overlay = document.querySelector('#confirm-overlay') as HTMLElement;
  overlay.dispatchEvent(new MouseEvent('click')); // target === overlay
  assert.equal(await byBackdrop, false);
});

test('a click inside the card does not dismiss the dialog', async () => {
  let settled = false;
  const choice = confirmDialog('Restore this version?');
  void choice.then(() => { settled = true; });

  const card = document.querySelector('#confirm-overlay .confirm-card') as HTMLElement;
  card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await Promise.resolve();

  assert.equal(settled, false, 'still open');
  assert.ok(document.querySelector('#confirm-overlay'), 'a card click is not a backdrop click');
  (document.querySelector('#confirm-overlay [data-act="cancel"]') as HTMLButtonElement).click();
  await choice;
});

test('a dismissed dialog stops listening for keys', async () => {
  // done() removes the document keydown handler; a leaked one from an earlier
  // dialog would resolve the *next* one as soon as any key is pressed.
  const first = confirmDialog('one');
  (document.querySelector('#confirm-overlay [data-act="cancel"]') as HTMLButtonElement).click();
  await first;

  let settled = false;
  const second = confirmDialog('two');
  void second.then(() => { settled = true; });
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
  await Promise.resolve();
  assert.equal(settled, false, 'an unrelated key leaves it open');

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(await second, false);
});
