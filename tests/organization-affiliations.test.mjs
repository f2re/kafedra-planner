import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { createScientificItem } from '../packages/science/src/service.mjs';
import {
  createAppointment,
  createOrganizationUnit
} from '../packages/organization/src/service.mjs';
import { refreshDerivedScientificAffiliations } from '../packages/organization/src/compatibility.mjs';

const migrationsDir = resolve('migrations');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-org-affiliation-'));
  const database = new Database(join(root, 'database.sqlite3'), { migrationsDir });
  const workspace = ensureDefaultWorkspace(database);
  return { root, database, workspace };
}

async function closeFixture(item) {
  item.database.close();
  await rm(item.root, { recursive: true, force: true });
}

test('публикация сохраняет подразделение автора на дату публикации после будущего перевода', async () => {
  const item = await fixture();
  try {
    const { database, workspace } = item;
    const actor = createPerson(database, workspace.id, { displayName: 'Администратор' });
    const author = createPerson(database, workspace.id, { displayName: 'Автор Исторический' });
    const oldUnit = createOrganizationUnit(database, workspace.id, {
      code: 'old-lab', name: 'Лаборатория радиолокации', unitKind: 'laboratory',
      validFrom: '2020-01-01', validTo: '2022-12-31'
    }, actor.id);
    const currentUnit = createOrganizationUnit(database, workspace.id, {
      code: 'current-lab', name: 'Лаборатория наукастинга', unitKind: 'laboratory',
      validFrom: '2023-01-01'
    }, actor.id);
    createAppointment(database, workspace.id, {
      personId: author.id, organizationUnitId: oldUnit.id,
      positionTitleSnapshot: 'Научный сотрудник', validFrom: '2020-01-01', validTo: '2022-12-31'
    }, actor.id);
    createAppointment(database, workspace.id, {
      personId: author.id, organizationUnitId: currentUnit.id,
      positionTitleSnapshot: 'Старший научный сотрудник', validFrom: '2023-01-01'
    }, actor.id);

    const science = createScientificItem(database, workspace.id, {
      title: 'Историческая публикация', kind: 'article',
      authors: ['Автор Исторический'], publicationYear: 2021
    }, '2026-08-21T08:00:00.000Z');
    refreshDerivedScientificAffiliations(database, workspace.id, author.id, '2026-08-21T08:01:00.000Z');

    const affiliation = database.get(`
      SELECT * FROM scientific_author_affiliations
      WHERE workspace_id = ? AND scientific_item_id = ? AND author_raw = ?
    `, workspace.id, science.id, 'Автор Исторический');
    assert.equal(affiliation.unit_name_snapshot, 'Лаборатория радиолокации');
    assert.equal(affiliation.position_name_snapshot, 'Научный сотрудник');
    assert.equal(affiliation.valid_on, '2021-12-31');
    assert.equal(affiliation.source_kind, 'derived');
  } finally {
    await closeFixture(item);
  }
});

test('назначение за пределами периода подразделения отклоняется без частичной записи', async () => {
  const item = await fixture();
  try {
    const { database, workspace } = item;
    const actor = createPerson(database, workspace.id, { displayName: 'Администратор' });
    const employee = createPerson(database, workspace.id, { displayName: 'Сотрудник Периода' });
    const unit = createOrganizationUnit(database, workspace.id, {
      code: 'dated-lab', name: 'Лаборатория с периодом', unitKind: 'laboratory',
      validFrom: '2023-01-01', validTo: '2025-12-31'
    }, actor.id);
    const before = database.get('SELECT COUNT(*) AS n FROM person_appointments').n;
    assert.throws(() => createAppointment(database, workspace.id, {
      personId: employee.id, organizationUnitId: unit.id,
      positionTitleSnapshot: 'Инженер', validFrom: '2022-09-01', validTo: '2024-08-31'
    }, actor.id), /organization_unit_period_mismatch/u);
    assert.equal(database.get('SELECT COUNT(*) AS n FROM person_appointments').n, before);
    assert.deepEqual(database.all('PRAGMA foreign_key_check'), []);
  } finally {
    await closeFixture(item);
  }
});
