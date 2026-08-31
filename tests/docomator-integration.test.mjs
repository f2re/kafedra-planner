import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import {
  checkDocomatorConnection,
  classifyDocomatorTransportError,
  getDocomatorSettings,
  importDocomatorPeople,
  normalizeDocomatorConnection
} from '../packages/integrations/src/docomator.mjs';

const migrationsDir = resolve('migrations');

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

function mockDocomator() {
  let firstName = 'Иванов Иван Иванович';
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    const cookie = init.headers?.cookie || init.headers?.get?.('cookie') || '';
    calls.push({ path: parsed.pathname, search: parsed.search, method: init.method || 'GET', cookie });
    if (parsed.pathname === '/healthz') {
      return json({ service: 'api', status: 'ok', version: '0.6.6' });
    }
    if (parsed.pathname === '/readyz') {
      return json({ service: 'api', status: 'ready' });
    }
    if (parsed.pathname === '/api/v1/access/unlock') {
      const body = JSON.parse(init.body || '{}');
      if (body.code !== '1234') return json({ error: { message: 'bad code' } }, 401);
      return json({ data: { unlocked: true } }, 200, { 'set-cookie': 'docomator_session=test-session; Path=/; HttpOnly' });
    }
    if (parsed.pathname.startsWith('/api/v1/') && cookie !== 'docomator_session=test-session') {
      return json({ error: { message: 'locked' } }, 401);
    }
    if (parsed.pathname === '/api/v1/spaces') {
      return json({ data: [{ id: 'space-1', key: 'department', name: 'Кафедра', status: 'active' }] });
    }
    if (parsed.pathname === '/api/v1/spaces/space-1/groups') {
      return json({ data: [{ id: 'group-1', name: 'Штат кафедры', memberCount: 3 }] });
    }
    if (parsed.pathname === '/api/v1/spaces/space-1/groups/group-1/members') {
      return json({ data: [
        { entityId: 'remote-1', displayName: firstName, entityTypeKey: 'person', status: 'active' },
        { entityId: 'remote-2', displayName: 'Петрова Анна', entityTypeKey: 'person', status: 'inactive' },
        { entityId: 'room-1', displayName: 'Аудитория 101', entityTypeKey: 'room', status: 'active' }
      ] });
    }
    if (parsed.pathname === '/api/v1/spaces/space-1/employees') {
      return json({ data: [
        { id: 'remote-1', displayName: firstName, status: 'active' },
        { id: 'remote-2', displayName: 'Петрова Анна', status: 'inactive' }
      ] });
    }
    return json({ error: { message: `unexpected ${parsed.pathname}` } }, 404);
  };
  return {
    fetchImpl,
    calls,
    rename(value) { firstName = value; }
  };
}

function transportFailure(code, name = 'TypeError') {
  const error = new Error('sensitive network detail must not be exposed');
  error.name = name;
  if (code) error.cause = { code };
  return error;
}

test('адрес Оформлятора нормализуется и проверяется до сетевого запроса', () => {
  assert.deepEqual(normalizeDocomatorConnection({ host: '192.168.10.20' }), {
    scheme: 'http', host: '192.168.10.20', port: 8080, baseUrl: 'http://192.168.10.20:8080'
  });
  assert.throws(() => normalizeDocomatorConnection({ host: 'http://bad/path' }), /docomator_host_invalid/u);
  assert.throws(() => normalizeDocomatorConnection({ host: 'server', port: 70000 }), /docomator_port_invalid/u);
});

test('transport failures receive stable safe diagnostic categories', async () => {
  const cases = [
    ['ENOTFOUND', 'TypeError', 'docomator_dns_error'],
    ['EAI_AGAIN', 'TypeError', 'docomator_dns_error'],
    ['ECONNREFUSED', 'TypeError', 'docomator_connection_refused'],
    ['ETIMEDOUT', 'TypeError', 'docomator_timeout'],
    ['UND_ERR_CONNECT_TIMEOUT', 'TypeError', 'docomator_timeout'],
    ['CERT_HAS_EXPIRED', 'TypeError', 'docomator_tls_error'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'TypeError', 'docomator_tls_error'],
    [null, 'TimeoutError', 'docomator_timeout'],
    ['EHOSTUNREACH', 'TypeError', 'docomator_unreachable']
  ];
  for (const [code, name, expected] of cases) {
    const error = transportFailure(code, name);
    assert.equal(classifyDocomatorTransportError(error), expected);
    await assert.rejects(
      checkDocomatorConnection({ host: 'docomator.local' }, { fetchImpl: async () => { throw error; } }),
      (caught) => caught?.code === expected && !String(caught?.details || '').includes('sensitive network detail')
    );
  }
});

test('проверка отличает чужой HTTP-сервис и неготовый Оформлятор', async () => {
  await assert.rejects(
    checkDocomatorConnection({ host: 'docomator.local' }, {
      fetchImpl: async () => json({ service: 'prometheus', status: 'ok' })
    }),
    (error) => error?.code === 'docomator_wrong_service'
  );

  const notReady = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/healthz') return json({ service: 'api', status: 'ok' });
    return json({ service: 'api', status: 'starting' }, 503);
  };
  await assert.rejects(
    checkDocomatorConnection({ host: 'docomator.local' }, { fetchImpl: notReady }),
    (error) => error?.code === 'docomator_not_ready'
  );
});

test('проверка различает доступность сервера, PIN и доступность списка сотрудников', async () => {
  const remote = mockDocomator();
  const locked = await checkDocomatorConnection({ host: 'docomator.local', port: 8080 }, { fetchImpl: remote.fetchImpl });
  assert.equal(locked.reachable, true);
  assert.equal(locked.ready, true);
  assert.equal(locked.authRequired, true);
  assert.equal(locked.dataAvailable, false);

  await assert.rejects(
    checkDocomatorConnection({ host: 'docomator.local', port: 8080, accessCode: '9999' }, { fetchImpl: remote.fetchImpl }),
    (error) => error?.code === 'docomator_access_denied'
  );

  const checked = await checkDocomatorConnection({
    host: 'docomator.local', port: 8080, accessCode: '1234', spaceId: 'space-1', groupId: 'group-1'
  }, { fetchImpl: remote.fetchImpl });
  assert.equal(checked.authRequired, false);
  assert.equal(checked.dataAvailable, true);
  assert.equal(checked.remoteVersion, '0.6.6');
  assert.equal(checked.spaces.length, 1);
  assert.equal(checked.groups.length, 1);
  assert.equal(checked.peopleCount, 1);
  assert.equal(checked.peoplePreview[0].displayName, 'Иванов Иван Иванович');
  assert.ok(remote.calls.some((call) => call.path === '/api/v1/access/unlock'));
});

test('импорт сотрудников идемпотентен по remote id и ФИО, код доступа не сохраняется', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-docomator-'));
  const database = new Database(join(root, 'db.sqlite3'), { migrationsDir });
  const remote = mockDocomator();
  try {
    const workspace = ensureDefaultWorkspace(database);
    const first = await importDocomatorPeople(database, workspace.id, {
      scheme: 'http', host: 'docomator.local', port: 8080, accessCode: '1234',
      spaceId: 'space-1', groupId: 'group-1', includeInactive: true
    }, { fetchImpl: remote.fetchImpl });
    assert.equal(first.stats.total, 2);
    assert.equal(first.stats.created, 2);
    assert.equal(database.get('SELECT COUNT(*) AS count FROM people WHERE workspace_id = ?', workspace.id).count, 2);
    assert.equal(database.get('SELECT COUNT(*) AS count FROM docomator_person_links WHERE workspace_id = ?', workspace.id).count, 2);

    const original = database.get(`
      SELECT p.id FROM people p JOIN docomator_person_links l ON l.person_id = p.id
      WHERE l.workspace_id = ? AND l.remote_employee_id = 'remote-1'
    `, workspace.id);
    remote.rename('Иванов Иван Петрович');
    const second = await importDocomatorPeople(database, workspace.id, {
      host: 'docomator.local', port: 8080, accessCode: '1234',
      spaceId: 'space-1', groupId: 'group-1', includeInactive: true
    }, { fetchImpl: remote.fetchImpl });
    assert.equal(second.stats.created, 0);
    const renamed = database.get('SELECT id, display_name FROM people WHERE id = ?', original.id);
    assert.equal(renamed.id, original.id);
    assert.equal(renamed.display_name, 'Иванов Иван Петрович');
    assert.equal(database.get('SELECT COUNT(*) AS count FROM people WHERE workspace_id = ?', workspace.id).count, 2);

    const inactive = database.get(`
      SELECT p.status FROM people p JOIN docomator_person_links l ON l.person_id = p.id
      WHERE l.workspace_id = ? AND l.remote_employee_id = 'remote-2'
    `, workspace.id);
    assert.equal(inactive.status, 'inactive');
    const settings = getDocomatorSettings(database, workspace.id);
    assert.equal(settings.host, 'docomator.local');
    assert.equal(settings.port, 8080);
    assert.equal(settings.spaceId, 'space-1');
    assert.equal(settings.groupId, 'group-1');
    assert.equal(Object.hasOwn(settings, 'accessCode'), false);
    assert.ok(settings.lastImportedAt);
    assert.ok(database.get("SELECT id FROM audit_log WHERE workspace_id = ? AND action = 'docomator.people.import'", workspace.id));
    assert.deepEqual(database.foreignKeyCheck(), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
