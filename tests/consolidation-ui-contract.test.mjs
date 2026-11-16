import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

async function text(path) { return readFile(path, 'utf8'); }
async function missing(path) { try { await access(path); return false; } catch { return true; } }

test('legacy unreachable frontend modules are removed', async () => {
  assert.equal(await missing('public/lifecycle-next.js'), true);
  assert.equal(await missing('public/plan-fact-origin.js'), true);
});

test('active password flows use application-owned masked dialogs', async () => {
  const auth = await text('public/auth-next.js');
  const reset = await text('public/admin-password-reset.js');
  const ux = await text('public/ux-next.js');
  assert.match(auth, /id="auth-password-dialog"/u);
  assert.match(auth, /type="password"/u);
  assert.doesNotMatch(auth, /window\.prompt\s*\(/u);
  assert.match(auth, /window\.kafedraRequestSecret/u);
  assert.match(reset, /data-admin-reset/u);
  assert.match(reset, /stopImmediatePropagation/u);
  assert.match(ux, /admin-password-reset\.js/u);
});

test('technical template type is under additional fields', async () => {
  const source = await text('public/fast-form-disclosure.js');
  assert.match(source, /template-more-fields/u);
  assert.match(source, /#template-document-type/u);
  assert.match(source, /Дополнительно/u);
});

test('plan fact failures have an observable error state', async () => {
  const source = await text('public/plan-fact-next.js');
  assert.match(source, /function showPlanFactError/u);
  assert.match(source, /role="alert"/u);
  assert.match(source, /runPlanFactLoad/u);
});
