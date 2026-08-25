import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { listUiPreferences, recordUiPreferences } from '../packages/preferences/src/service.mjs';
import { createUiPreferencesRouter } from '../apps/api/src/ui-preferences-router.mjs';

function insertPerson(database, workspaceId, id, name) {
  const now = '2026-08-15T06:00:00.000Z';
  database.run(
    "INSERT INTO people(id,workspace_id,display_name,normalized_name,status,created_at,updated_at) VALUES(?,?,?,?, 'active',?,?)",
    id, workspaceId, name, name.toLocaleLowerCase('ru-RU'), now, now
  );
}

function insertAccount(database, workspaceId, personId, id) {
  const now = '2026-08-15T06:00:00.000Z';
  database.run(`
    INSERT INTO auth_accounts(
      id,workspace_id,person_id,username,normalized_username,role,password_hash,password_changed_at,created_at,updated_at
    ) VALUES(?,?,?,?,?,'staff','test-hash',?,?,?)
  `, id, workspaceId, personId, id, id, now, now, now);
}

function mockResponse() {
  return {
    status: null,
    headers: null,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body = '') { this.body += body; }
  };
}

function postRequest(auth, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  return {
    method: 'POST', auth, headers: {},
    async *[Symbol.asyncIterator]() { yield bytes; }
  };
}

test('обучаемые defaults считают только уникальные явные действия и изолированы по аккаунту', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-ui-preferences-'));
  const database = new Database(join(root, 'db.sqlite3'), { migrationsDir: resolve('migrations') });
  try {
    const workspace = ensureDefaultWorkspace(database);
    insertPerson(database, workspace.id, 'person_ivanov', 'Иванов Иван Иванович');
    insertPerson(database, workspace.id, 'person_petrov', 'Петров Пётр Петрович');
    insertPerson(database, workspace.id, 'person_other', 'Другой Пользователь');
    insertAccount(database, workspace.id, 'person_ivanov', 'account_main');
    insertAccount(database, workspace.id, 'person_other', 'account_other');

    recordUiPreferences(database, workspace.id, 'account_main', {
      interactionId: 'chair-1', choices: [{ key: 'meeting.chairperson', value: 'person_ivanov' }]
    }, '2026-08-15T06:01:00.000Z');
    recordUiPreferences(database, workspace.id, 'account_main', {
      interactionId: 'chair-2', choices: [{ key: 'meeting.chairperson', value: 'person_ivanov' }]
    }, '2026-08-15T06:02:00.000Z');
    recordUiPreferences(database, workspace.id, 'account_main', {
      interactionId: 'chair-3', choices: [{ key: 'meeting.chairperson', value: 'person_ivanov' }]
    }, '2026-08-15T06:03:00.000Z');
    recordUiPreferences(database, workspace.id, 'account_main', {
      interactionId: 'chair-p', choices: [{ key: 'meeting.chairperson', value: 'person_petrov' }]
    }, '2026-08-15T06:04:00.000Z');
    recordUiPreferences(database, workspace.id, 'account_main', {
      interactionId: 'chair-3', choices: [{ key: 'meeting.chairperson', value: 'person_ivanov' }]
    }, '2026-08-15T06:05:00.000Z');

    const ranked = listUiPreferences(database, workspace.id, 'account_main', ['meeting.chairperson']);
    assert.deepEqual(ranked['meeting.chairperson'].map((item) => [item.value, item.count]), [
      ['person_ivanov', 3], ['person_petrov', 1]
    ]);
    assert.deepEqual(listUiPreferences(database, workspace.id, 'account_other', ['meeting.chairperson'])['meeting.chairperson'], []);

    recordUiPreferences(database, workspace.id, 'account_main', {
      interactionId: 'calendar-1', choices: [
        { key: 'calendar.new.category', value: 'science' },
        { key: 'calendar.new.reminder', value: '1440' },
        { key: 'template.field.required', value: '0' },
        { key: 'template.document.type', value: 'directive_document' }
      ]
    });
    recordUiPreferences(database, workspace.id, 'account_main', {
      interactionId: 'global-ux-1', choices: [
        { key: 'calendar.new.date_offset', value: 'd:7' },
        { key: 'meeting.new.date_offset', value: 'd:-2' },
        { key: 'work.periodic.start_offset', value: 'none' },
        { key: 'work.periodic.due_offset', value: 'd:14' },
        { key: 'template.field.type', value: 'date' },
        { key: 'template.field.strategy', value: 'next_line' },
        { key: 'work.periodic.period_kind', value: 'academic_year' },
        { key: 'work.periodic.direction', value: 'science' },
        { key: 'work.periodic.owner', value: 'person_ivanov' },
        { key: 'work.responsibility.controller', value: 'person_petrov' },
        { key: 'profile.current_person', value: '' },
        { key: 'search.filter.status', value: 'completed' },
        { key: 'plans.filter.period', value: '2026/27' },
        { key: 'calendar.filter.categories', value: 'education,science' },
        { key: 'admin.object.kind', value: 'scientific_item' }
      ]
    });

    const defaults = listUiPreferences(database, workspace.id, 'account_main', [
      'calendar.new.category', 'calendar.new.reminder', 'template.field.required', 'template.document.type',
      'calendar.new.date_offset', 'meeting.new.date_offset', 'work.periodic.start_offset', 'work.periodic.due_offset',
      'template.field.type', 'template.field.strategy', 'work.periodic.period_kind', 'work.periodic.direction',
      'work.periodic.owner', 'work.responsibility.controller', 'profile.current_person', 'search.filter.status',
      'plans.filter.period', 'calendar.filter.categories', 'admin.object.kind'
    ]);
    assert.equal(defaults['calendar.new.category'][0].value, 'science');
    assert.equal(defaults['calendar.new.reminder'][0].value, '1440');
    assert.equal(defaults['template.field.required'][0].value, '0');
    assert.equal(defaults['template.document.type'][0].value, 'directive_document');
    assert.equal(defaults['calendar.new.date_offset'][0].value, 'd:7');
    assert.equal(defaults['meeting.new.date_offset'][0].value, 'd:-2');
    assert.equal(defaults['work.periodic.start_offset'][0].value, 'none');
    assert.equal(defaults['work.periodic.due_offset'][0].value, 'd:14');
    assert.equal(defaults['template.field.type'][0].value, 'date');
    assert.equal(defaults['template.field.strategy'][0].value, 'next_line');
    assert.equal(defaults['work.periodic.period_kind'][0].value, 'academic_year');
    assert.equal(defaults['work.periodic.direction'][0].value, 'science');
    assert.equal(defaults['work.periodic.owner'][0].value, 'person_ivanov');
    assert.equal(defaults['work.responsibility.controller'][0].value, 'person_petrov');
    assert.equal(defaults['profile.current_person'][0].value, '');
    assert.equal(defaults['search.filter.status'][0].value, 'completed');
    assert.equal(defaults['plans.filter.period'][0].value, '2026/27');
    assert.equal(defaults['calendar.filter.categories'][0].value, 'science,education');
    assert.equal(defaults['admin.object.kind'][0].value, 'scientific_item');

    assert.throws(() => recordUiPreferences(database, workspace.id, 'account_main', {
      interactionId: 'bad-1', choices: [{ key: 'calendar.new.category', value: 'invented' }]
    }), (error) => error?.code === 'ui_preference_value_invalid');
    assert.throws(() => recordUiPreferences(database, workspace.id, 'account_main', {
      interactionId: 'bad-2', choices: [{ key: 'password', value: 'secret' }]
    }), (error) => error?.code === 'ui_preference_key_invalid');
    assert.throws(() => recordUiPreferences(database, workspace.id, 'account_main', {
      interactionId: 'bad-date-1', choices: [{ key: 'calendar.new.date_offset', value: '2026-09-01' }]
    }), (error) => error?.code === 'ui_preference_value_invalid');
    assert.throws(() => recordUiPreferences(database, workspace.id, 'account_main', {
      interactionId: 'bad-date-2', choices: [{ key: 'calendar.new.date_offset', value: 'd:900' }]
    }), (error) => error?.code === 'ui_preference_value_invalid');
    assert.throws(() => recordUiPreferences(database, workspace.id, 'account_main', {
      interactionId: 'bad-security', choices: [{ key: 'admin.account.role', value: 'admin' }]
    }), (error) => error?.code === 'ui_preference_key_invalid');

    assert.equal(database.get('SELECT MAX(version) AS v FROM schema_migrations').v, 20);

    const router = createUiPreferencesRouter({ database });
    const auth = { accountId: 'account_main', workspaceId: workspace.id };
    const response = mockResponse();
    const handled = await router(
      postRequest(auth, {
        interactionId: 'api-1', choices: [{ key: 'calendar.mode', value: 'week' }]
      }),
      response,
      new URL('http://localhost/api/ui-preferences')
    );
    assert.notEqual(handled, false);
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body).preferences['calendar.mode'][0].value, 'week');
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('схема 020 обновляет существующую схему 17 без изменения предметных данных', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-ui-preferences-migration-'));
  const oldMigrations = join(root, 'migrations-017');
  await mkdir(oldMigrations, { recursive: true });
  let upgraded = null;
  try {
    const files = (await readdir(resolve('migrations')))
      .filter((name) => /^(?:00[1-9]|01[0-7])_.*\.sql$/u.test(name))
      .sort();
    assert.equal(files.length, 17);
    for (const file of files) await copyFile(resolve('migrations', file), join(oldMigrations, file));

    const databasePath = join(root, 'existing.sqlite3');
    const oldDatabase = new Database(databasePath, { migrationsDir: oldMigrations });
    const workspace = ensureDefaultWorkspace(oldDatabase);
    insertPerson(oldDatabase, workspace.id, 'person_existing', 'Существующий Сотрудник');
    insertAccount(oldDatabase, workspace.id, 'person_existing', 'account_existing');
    oldDatabase.run(`
      INSERT INTO calendar_items(
        id,workspace_id,source_kind,source_id,item_kind,title,starts_at,ends_at,
        all_day,category,status,importance,created_at,updated_at
      ) VALUES(
        'existing-task',?,'manual','existing-task','task','Существующая задача',
        '2026-09-01','2026-09-01',1,'organizational','open','normal',?,?
      )
    `, workspace.id, '2026-08-15T06:00:00.000Z', '2026-08-15T06:00:00.000Z');
    assert.equal(oldDatabase.get('SELECT MAX(version) AS v FROM schema_migrations').v, 17);
    oldDatabase.close();

    upgraded = new Database(databasePath, { migrationsDir: resolve('migrations') });
    assert.equal(upgraded.get('SELECT MAX(version) AS v FROM schema_migrations').v, 20);
    assert.equal(upgraded.get("SELECT title FROM calendar_items WHERE id='existing-task'").title, 'Существующая задача');
    assert.equal(upgraded.get("SELECT display_name FROM people WHERE id='person_existing'").display_name, 'Существующий Сотрудник');
    recordUiPreferences(upgraded, workspace.id, 'account_existing', {
      interactionId: 'after-upgrade', choices: [{ key: 'calendar.new.date_offset', value: 'd:3' }]
    });
    assert.equal(
      upgraded.get("SELECT COUNT(*) AS c FROM ui_choice_preferences WHERE account_id='account_existing'").c,
      1
    );
  } finally {
    upgraded?.close();
    await rm(root, { recursive: true, force: true });
  }
});