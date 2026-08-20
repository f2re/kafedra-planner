import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('API и UI организационной структуры подключены к приложению', async () => {
  const app = await readFile('apps/api/src/app.mjs', 'utf8');
  const ux = await readFile('public/ux-next.js', 'utf8');
  assert.match(app, /createOrganizationRouter/u);
  assert.match(app, /organizationHandled/u);
  assert.match(ux, /organization-next\.js/u);
});
