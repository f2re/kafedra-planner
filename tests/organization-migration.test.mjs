import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { createManualPlan } from '../packages/plans/src/manual.mjs';
import { createScientificItem } from '../packages/science/src/service.mjs';

const migrationsDir = resolve('migrations');

async function migrationsThrough19(root) {
  const target = join(root, 'migrations-19');
  await mkdir(target, { recursive: true });
  for (const file of (await readdir(migrationsDir)).filter((name) => /^\d+_.*\.sql$/u.test(name)).sort()) {
    if (Number.parseInt(file, 10) <= 19) await copyFile(join(migrationsDir, file), join(target, file));
  }
  return target;
}

test('schema 20 обновляет существующую схему 19 без потери документов, планов, людей и научных карточек', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-schema20-upgrade-'));
  const databasePath = join(root, 'existing.sqlite3');
  const oldMigrations = await migrationsThrough19(root);
  let database;
  let ids;
  try {
    database = new Database(databasePath, { migrationsDir: oldMigrations });
    const workspace = ensureDefaultWorkspace(database);
    const manager = createPerson(database, workspace.id, {
      displayName: 'Руководитель До Обновления', position: 'Заведующий кафедрой'
    });
    const employee = createPerson(database, workspace.id, {
      displayName: 'Сотрудник До Обновления', position: 'Доцент', managerId: manager.id
    });
    const plan = createManualPlan(database, workspace.id, {
      title: 'План до обновления', planKind: 'department', periodKind: 'calendar', yearStart: 2026
    }, manager.id);
    const science = createScientificItem(database, workspace.id, {
      title: 'Статья до обновления', kind: 'article', authors: ['Сотрудник До Обновления'], publicationYear: 2025
    });
    assert.equal(database.get('SELECT MAX(version) AS v FROM schema_migrations').v, 19);
    ids = { workspaceId: workspace.id, managerId: manager.id, employeeId: employee.id, planId: plan.id, scienceId: science.id };
    database.close(); database = null;

    database = new Database(databasePath, { migrationsDir });
    assert.equal(database.get('SELECT MAX(version) AS v FROM schema_migrations').v, 20);
    assert.equal(database.get('SELECT display_name FROM people WHERE id = ?', ids.employeeId).display_name, 'Сотрудник До Обновления');
    assert.equal(database.get('SELECT manager_id FROM people WHERE id = ?', ids.employeeId).manager_id, ids.managerId);
    assert.equal(database.get('SELECT title FROM plans WHERE id = ?', ids.planId).title, 'План до обновления');
    assert.equal(database.get('SELECT title FROM scientific_items WHERE id = ?', ids.scienceId).title, 'Статья до обновления');
    const appointment = database.get(`
      SELECT * FROM person_appointments WHERE workspace_id = ? AND person_id = ? AND appointment_kind = 'primary'
    `, ids.workspaceId, ids.employeeId);
    assert.ok(appointment);
    assert.equal(appointment.position_title_snapshot, 'Доцент');
    assert.equal(JSON.parse(appointment.evidence_json).managerPersonId, ids.managerId);
    assert.ok(database.get("SELECT id FROM organization_units WHERE workspace_id = ? AND code = 'legacy-root'", ids.workspaceId));
    const affiliation = database.get('SELECT * FROM scientific_author_affiliations WHERE scientific_item_id = ?', ids.scienceId);
    assert.equal(affiliation.person_id, ids.employeeId);
    assert.deepEqual(database.all('PRAGMA foreign_key_check'), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    database?.close();
    await rm(root, { recursive: true, force: true });
  }
});
