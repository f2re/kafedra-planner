import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import {
  discoverDocomatorFields,
  getDocomatorFieldMapping,
  importDocomatorPeopleWithFields,
  listDocomatorPersonFields
} from '../packages/integrations/src/docomator-fields.mjs';

const migrationsDir = resolve('migrations');

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

function remoteMock() {
  let phone = '+7 900 000-00-01';
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    const cookie = init.headers?.cookie || init.headers?.get?.('cookie') || '';
    if (parsed.pathname === '/api/v1/access/unlock') {
      const body = JSON.parse(init.body || '{}');
      if (body.code !== '1234') return json({ error: { message: 'bad code' } }, 401);
      return json({ data: { unlocked: true } }, 200, { 'set-cookie': 'docomator_session=test; Path=/; HttpOnly' });
    }
    if (parsed.pathname.startsWith('/api/v1/') && cookie !== 'docomator_session=test') {
      return json({ error: { message: 'locked' } }, 401);
    }
    if (parsed.pathname === '/api/v1/spaces') {
      return json({ data: [{ id: 'space-1', name: 'Кафедра', status: 'active' }] });
    }
    if (parsed.pathname === '/api/v1/knowledge/property-definitions') {
      return json({ data: [
        { key: 'email', label: 'Электронная почта', valueType: 'string', appliesTo: ['person'], aliases: ['e-mail'] },
        { key: 'position', label: 'Должность', valueType: 'string', appliesTo: ['person'] },
        { key: 'phone', label: 'Телефон', valueType: 'string', appliesTo: ['person'] },
        { key: 'room_number', label: 'Номер аудитории', valueType: 'string', appliesTo: ['room'] }
      ] });
    }
    if (parsed.pathname === '/api/v1/spaces/space-1/groups/group-1/members') {
      return json({ data: [
        { entityId: 'remote-1', displayName: 'Иванов Иван Иванович', entityTypeKey: 'person', status: 'active' }
      ] });
    }
    if (parsed.pathname === '/api/v1/spaces/space-1/employees') {
      return json({ data: [{ id: 'remote-1', displayName: 'Иванов Иван Иванович', status: 'active' }] });
    }
    if (parsed.pathname === '/api/v1/spaces/space-1/employees/remote-1') {
      return json({ data: {
        id: 'remote-1', displayName: 'Иванов Иван Иванович', status: 'active', fields: [
          { definition: { key: 'email', label: 'Электронная почта', valueType: 'string' }, value: 'ivanov@example.test' },
          { definition: { key: 'position', label: 'Должность', valueType: 'string' }, value: 'Доцент' },
          { definition: { key: 'phone', label: 'Телефон', valueType: 'string' }, value: phone }
        ]
      } });
    }
    if (parsed.pathname === '/api/v1/spaces/space-1/groups') return json({ data: [] });
    return json({ error: { message: `unexpected ${parsed.pathname}` } }, 404);
  };
  return { fetchImpl, setPhone(value) { phone = value; } };
}

test('Оформлятор отдаёт только поля людей и предлагает e-mail/должность', async () => {
  const remote = remoteMock();
  const result = await discoverDocomatorFields({
    host: 'docomator.local', port: 8080, accessCode: '1234', spaceId: 'space-1'
  }, { fetchImpl: remote.fetchImpl });
  assert.deepEqual(result.properties.map((item) => item.key).sort(), ['email', 'phone', 'position']);
  assert.equal(result.suggestedMappings.emailPropertyKey, 'email');
  assert.equal(result.suggestedMappings.positionPropertyKey, 'position');
});

test('выбранные поля импортируются без дублей и дополнительные значения сохраняют происхождение', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-docomator-fields-'));
  const database = new Database(join(root, 'db.sqlite3'), { migrationsDir });
  const remote = remoteMock();
  try {
    const workspace = ensureDefaultWorkspace(database);
    const input = {
      host: 'docomator.local', port: 8080, accessCode: '1234',
      spaceId: 'space-1', groupId: 'group-1', includeInactive: false,
      emailPropertyKey: 'email', positionPropertyKey: 'position', extraPropertyKeys: ['phone']
    };
    const first = await importDocomatorPeopleWithFields(database, workspace.id, input, { fetchImpl: remote.fetchImpl });
    assert.equal(first.stats.created, 1);
    assert.equal(first.fieldStats.mapped, 2);
    assert.equal(first.fieldStats.extras, 1);
    const person = database.get('SELECT * FROM people WHERE workspace_id = ?', workspace.id);
    assert.equal(person.email, 'ivanov@example.test');
    assert.equal(person.position, 'Доцент');
    assert.deepEqual(listDocomatorPersonFields(database, workspace.id, person.id).map((item) => [item.key, item.value]), [
      ['phone', '+7 900 000-00-01']
    ]);
    assert.deepEqual(getDocomatorFieldMapping(database, workspace.id), {
      emailPropertyKey: 'email', positionPropertyKey: 'position', extraPropertyKeys: ['phone']
    });

    remote.setPhone('+7 900 000-00-02');
    const second = await importDocomatorPeopleWithFields(database, workspace.id, input, { fetchImpl: remote.fetchImpl });
    assert.equal(second.stats.created, 0);
    assert.equal(database.get('SELECT COUNT(*) AS count FROM people WHERE workspace_id = ?', workspace.id).count, 1);
    assert.equal(listDocomatorPersonFields(database, workspace.id, person.id)[0].value, '+7 900 000-00-02');
    assert.ok(database.get("SELECT id FROM audit_log WHERE workspace_id = ? AND action = 'docomator.people.fields.sync'", workspace.id));
    assert.deepEqual(database.foreignKeyCheck(), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('удалённое выбранное поле требует обновить схему вместо тихой потери данных', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-docomator-fields-invalid-'));
  const database = new Database(join(root, 'db.sqlite3'), { migrationsDir });
  const remote = remoteMock();
  try {
    const workspace = ensureDefaultWorkspace(database);
    await assert.rejects(
      importDocomatorPeopleWithFields(database, workspace.id, {
        host: 'docomator.local', port: 8080, accessCode: '1234', spaceId: 'space-1',
        emailPropertyKey: 'removed_field'
      }, { fetchImpl: remote.fetchImpl }),
      /docomator_property_not_found/u
    );
    assert.equal(database.get('SELECT COUNT(*) AS count FROM people WHERE workspace_id = ?', workspace.id).count, 0);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
