import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { createManualPlan } from '../packages/plans/src/manual.mjs';
import { createScientificItem } from '../packages/science/src/service.mjs';

const migrationsDir = resolve('migrations');

async function migrationsThrough(root, maxVersion) {
  const target = join(root, `migrations-${maxVersion}`);
  await mkdir(target, { recursive: true });
  const files = (await readdir(migrationsDir)).filter((name) => /^\d+_.*\.sql$/u.test(name)).sort();
  for (const name of files) {
    if (Number(name.match(/^(\d+)/u)?.[1] || 0) <= maxVersion) {
      await copyFile(join(migrationsDir, name), join(target, basename(name)));
    }
  }
  return target;
}

test('обновление 19 → 20 сохраняет планы, сотрудников и научные карточки', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-org-migration-'));
  const path = join(root, 'database.sqlite3');
  const oldMigrations = await migrationsThrough(root, 19);
  const targetMigrations = await migrationsThrough(root, 20);
  let database = new Database(path, { migrationsDir: oldMigrations });
  let workspace;
  let employee;
  let plan;
  let science;
  try {
    workspace = ensureDefaultWorkspace(database);
    const manager = createPerson(database, workspace.id, { displayName: 'Руководитель До Миграции', position: 'Заведующий кафедрой' });
    employee = createPerson(database, workspace.id, {
      displayName: 'Сотрудник До Миграции', position: 'Доцент', managerId: manager.id
    });
    plan = createManualPlan(database, workspace.id, {
      title: 'План до миграции', planKind: 'department', periodKind: 'calendar', yearStart: 2026
    }, manager.id);
    science = createScientificItem(database, workspace.id, {
      title: 'Статья до миграции', kind: 'article', authors: ['Сотрудник До Миграции'], publicationYear: 2025
    });
    assert.equal(database.getSchemaVersion(), 19);
  } finally {
    database.close();
  }

  database = new Database(path, { migrationsDir: targetMigrations });
  try {
    assert.equal(database.getSchemaVersion(), 20);
    assert.equal(database.get('SELECT title FROM plans WHERE id = ?', plan.id).title, 'План до миграции');
    const appointment = database.get(`
      SELECT pa.*, op.name AS position_name, manager.display_name AS manager_name
      FROM person_appointments pa
      LEFT JOIN organization_positions op ON op.id = pa.position_id
      LEFT JOIN people manager ON manager.id = pa.manager_person_id
      WHERE pa.person_id = ? AND pa.appointment_kind = 'primary'
    `, employee.id);
    assert.equal(appointment.position_name, 'Доцент');
    assert.equal(appointment.manager_name, 'Руководитель До Миграции');
    assert.ok(database.get("SELECT id FROM organizational_units WHERE workspace_id = ? AND code = 'ROOT'", workspace.id));
    const affiliation = database.get('SELECT * FROM scientific_author_affiliations WHERE scientific_item_id = ?', science.id);
    assert.equal(affiliation.person_id, employee.id);
    assert.deepEqual(database.foreignKeyCheck(), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
