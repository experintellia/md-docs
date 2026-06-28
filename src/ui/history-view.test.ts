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
