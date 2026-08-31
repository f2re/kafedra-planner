import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('контур успеваемости подключён через factory-router без замены createApp', async () => {
  const app = await readFile('apps/api/src/app.mjs', 'utf8');
  assert.match(app, /import \{ createAcademicPerformanceRouter \} from '\.\/academic-performance-router\.mjs';/u);
  assert.match(app, /const academicPerformanceRouter = createAcademicPerformanceRouter\(\{ database, logger \}\);/u);
  assert.match(app, /await academicPerformanceRouter\(request, response, url, requestId\)/u);
  assert.match(app, /createOrganizationRouter\(\{ database, logger \}\)/u);

  const ux = await readFile('public/ux-next.js', 'utf8');
  assert.match(ux, /await import\('\.\/academic-performance-next\.js'\);/u);
});
