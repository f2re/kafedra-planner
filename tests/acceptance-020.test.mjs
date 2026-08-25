import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { createOrganizationPosition, createPersonAppointment, organizationSnapshot } from '../packages/organization/src/service.mjs';
import { createScientificItem } from '../packages/science/src/service.mjs';
import { collectV020DatabaseEvidence, compareAcceptanceEvidence020, V020_STABLE_TABLES } from '../packages/system/src/acceptance-020.mjs';

const migrationsDir = resolve('migrations');

test('акт 0.2.0 содержит все новые устойчивые таблицы и замечает изменение', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-acceptance-020-'));
  const path = join(root, 'database.sqlite3');
  const database = new Database(path, { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const person = createPerson(database, workspace.id, { displayName: 'Сотрудник Акта' });
    const rootUnit = organizationSnapshot(database, workspace.id, { includeInactive: true }).tree[0];
    const position = createOrganizationPosition(database, workspace.id, { name: 'Научный сотрудник' }, person.id);
    createPersonAppointment(database, workspace.id, person.id, {
      unitId: rootUnit.id, positionId: position.id, validFrom: '2020-01-01'
    }, person.id);
    createScientificItem(database, workspace.id, {
      title: 'Материал акта 0.2.0', kind: 'article', authors: ['Сотрудник Акта'], publicationYear: 2026
    });

    const before = collectV020DatabaseEvidence(path);
    assert.deepEqual(before.missing, []);
    assert.deepEqual(Object.keys(before.tables).sort(), [...V020_STABLE_TABLES].sort());
    assert.equal(before.tables.person_appointments.rows, 1);
    assert.equal(before.tables.scientific_author_affiliations.rows, 1);

    database.run(`UPDATE person_appointments SET reason = 'Проверяемое изменение акта' WHERE person_id = ?`, person.id);
    const after = collectV020DatabaseEvidence(path);
    assert.notEqual(before.digest, after.digest);
    const comparison = compareAcceptanceEvidence020(
      { database: { v020: before }, application: {}, acceptance: {} },
      { database: { v020: after }, application: {}, acceptance: {} }
    );
    assert.equal(comparison.status, 'different');
    assert.ok(comparison.differences.some((item) => item.field === 'database.v020.digest'));
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
