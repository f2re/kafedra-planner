import { newId } from '../../core/src/ids.mjs';
import {
  DocomatorIntegrationError,
  classifyDocomatorTransportError,
  importDocomatorPeople,
  normalizeDocomatorConnection
} from './docomator.mjs';

const MAX_REMOTE_ITEMS = 1_000;
const MAX_PROPERTIES = 500;
const MAX_EXTRA_FIELDS = 100;
const PROFILE_CONCURRENCY = 8;
const TIMEOUT_MS = 6_000;
const ACCESS_CODE_PATTERN = /^\d{4}$/u;
const PROPERTY_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$/u;

function fail(code, details = null) {
  throw new DocomatorIntegrationError(code, details);
}

function optionalText(value, max = 500) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return text.slice(0, max);
}

function propertyKey(value, field) {
  const key = optionalText(value, 160);
  if (!key) return null;
  if (!PROPERTY_KEY_PATTERN.test(key)) fail('docomator_property_key_invalid', { field, key });
  return key;
}

function extraPropertyKeys(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_EXTRA_FIELDS) {
    fail('docomator_extra_fields_invalid', { max: MAX_EXTRA_FIELDS });
  }
  const result = [];
  const seen = new Set();
  for (const raw of value) {
    const key = propertyKey(raw, 'extraPropertyKeys');
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  }
  return result;
}

function parseStringArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function getDocomatorFieldMapping(database, workspaceId) {
  const row = database.get(
    'SELECT * FROM docomator_field_mappings WHERE workspace_id = ?',
    workspaceId
  );
  return {
    emailPropertyKey: row?.email_property_key || null,
    positionPropertyKey: row?.position_property_key || null,
    extraPropertyKeys: parseStringArray(row?.extra_property_keys_json)
  };
}

export function saveDocomatorFieldMapping(database, workspaceId, input = {}, now = new Date().toISOString()) {
  const emailPropertyKey = propertyKey(input.emailPropertyKey, 'emailPropertyKey');
  const positionPropertyKey = propertyKey(input.positionPropertyKey, 'positionPropertyKey');
  const extra = extraPropertyKeys(input.extraPropertyKeys);
  database.run(`
    INSERT INTO docomator_field_mappings(
      workspace_id, email_property_key, position_property_key,
      extra_property_keys_json, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      email_property_key = excluded.email_property_key,
      position_property_key = excluded.position_property_key,
      extra_property_keys_json = excluded.extra_property_keys_json,
      updated_at = excluded.updated_at
  `, workspaceId, emailPropertyKey, positionPropertyKey, JSON.stringify(extra), now);
  return getDocomatorFieldMapping(database, workspaceId);
}

function headers(cookie = null) {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    ...(cookie ? { cookie } : {})
  };
}

async function remoteFetch(connection, path, {
  method = 'GET', body, cookie = null, fetchImpl = globalThis.fetch
} = {}) {
  let response;
  try {
    response = await fetchImpl(`${connection.baseUrl}${path}`, {
      method,
      headers: headers(cookie),
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(TIMEOUT_MS) : undefined
    });
  } catch (error) {
    fail(classifyDocomatorTransportError(error));
  }
  const text = await response.text().catch(() => '');
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch {}
  }
  return { response, payload, text };
}

async function requestData(connection, path, options = {}) {
  const result = await remoteFetch(connection, path, options);
  if (result.response.status === 401 || result.response.status === 403) {
    fail('docomator_auth_required');
  }
  if (!result.response.ok) {
    fail('docomator_remote_error', {
      status: result.response.status,
      message: optionalText(result.payload?.error?.message || result.payload?.message || result.text, 500)
    });
  }
  if (!result.payload || typeof result.payload !== 'object') {
    fail('docomator_protocol_error', { path });
  }
  return result.payload.data ?? result.payload;
}

function cookieFrom(response) {
  const value = response.headers.get('set-cookie');
  return value ? value.split(';', 1)[0]?.trim() || null : null;
}

async function session(connection, accessCode, fetchImpl) {
  const spacesPath = `/api/v1/spaces?status=active&limit=${MAX_REMOTE_ITEMS}`;
  try {
    const spaces = await requestData(connection, spacesPath, { fetchImpl });
    return { cookie: null, spaces: Array.isArray(spaces) ? spaces : [] };
  } catch (error) {
    if (!(error instanceof DocomatorIntegrationError) || error.code !== 'docomator_auth_required') throw error;
  }
  const code = String(accessCode || '').trim();
  if (!code) fail('docomator_auth_required');
  if (!ACCESS_CODE_PATTERN.test(code)) fail('docomator_access_code_invalid');
  const unlocked = await remoteFetch(connection, '/api/v1/access/unlock', {
    method: 'POST', body: { code }, fetchImpl
  });
  if (unlocked.response.status === 401 || unlocked.response.status === 403) {
    fail('docomator_access_denied');
  }
  if (!unlocked.response.ok) fail('docomator_remote_error', { status: unlocked.response.status });
  const cookie = cookieFrom(unlocked.response);
  if (!cookie) fail('docomator_protocol_error', { path: '/api/v1/access/unlock' });
  const spaces = await requestData(connection, spacesPath, { cookie, fetchImpl });
  return { cookie, spaces: Array.isArray(spaces) ? spaces : [] };
}

function normalizedDefinition(item) {
  const key = propertyKey(item?.key, 'remotePropertyKey');
  const label = optionalText(item?.label || key, 500);
  if (!key || !label) return null;
  const appliesTo = Array.isArray(item?.appliesTo) ? item.appliesTo.filter((v) => typeof v === 'string') : [];
  if (appliesTo.length && !appliesTo.includes('person')) return null;
  return {
    key,
    label,
    valueType: optionalText(item?.valueType, 80) || 'string',
    uiGroup: optionalText(item?.uiGroup, 80),
    aliases: Array.isArray(item?.aliases) ? item.aliases.filter((v) => typeof v === 'string').slice(0, 20) : []
  };
}

async function propertyDefinitions(connection, spaceId, cookie, fetchImpl) {
  const rows = await requestData(
    connection,
    `/api/v1/knowledge/property-definitions?spaceId=${encodeURIComponent(spaceId)}&limit=${MAX_PROPERTIES}`,
    { cookie, fetchImpl }
  );
  return (Array.isArray(rows) ? rows : [])
    .map(normalizedDefinition)
    .filter(Boolean)
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
}

function score(definition, kind) {
  const haystack = [definition.key, definition.label, ...(definition.aliases || [])]
    .join(' ')
    .toLocaleLowerCase('ru-RU');
  if (kind === 'email') {
    if (/^(email|mail)$/iu.test(definition.key)) return 100;
    if (/e-?mail|электронн.*почт|почт.*адрес/iu.test(haystack)) return 80;
  }
  if (kind === 'position') {
    if (/^(position|job[_-]?title)$/iu.test(definition.key)) return 100;
    if (/должност|position|job title/iu.test(haystack)) return 80;
  }
  return 0;
}

function suggest(properties, kind) {
  return properties
    .map((item) => ({ item, score: score(item, kind) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label, 'ru'))[0]?.item.key || null;
}

export async function discoverDocomatorFields(input, { fetchImpl = globalThis.fetch } = {}) {
  const connection = normalizeDocomatorConnection(input);
  const spaceId = optionalText(input.spaceId, 160);
  if (!spaceId) return { properties: [], suggestedMappings: { emailPropertyKey: null, positionPropertyKey: null } };
  const active = await session(connection, input.accessCode, fetchImpl);
  if (!active.spaces.some((space) => String(space?.id) === spaceId)) {
    fail('docomator_space_not_found', { spaceId });
  }
  const properties = await propertyDefinitions(connection, spaceId, active.cookie, fetchImpl);
  return {
    properties,
    suggestedMappings: {
      emailPropertyKey: suggest(properties, 'email'),
      positionPropertyKey: suggest(properties, 'position')
    }
  };
}

async function remotePeopleIds(connection, input, cookie, fetchImpl) {
  const spaceId = optionalText(input.spaceId, 160);
  if (!spaceId) fail('docomator_remote_id_required', { field: 'spaceId' });
  let rows;
  if (input.groupId) {
    rows = await requestData(
      connection,
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/groups/${encodeURIComponent(input.groupId)}/members`,
      { cookie, fetchImpl }
    );
    rows = (Array.isArray(rows) ? rows : []).filter((item) => item?.entityTypeKey === 'person');
  } else {
    const status = input.includeInactive ? '' : '&status=active';
    rows = await requestData(
      connection,
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/employees?limit=${MAX_REMOTE_ITEMS}${status}`,
      { cookie, fetchImpl }
    );
  }
  return (Array.isArray(rows) ? rows : [])
    .filter((item) => input.includeInactive || String(item?.status || 'active') === 'active')
    .map((item) => optionalText(item?.id ?? item?.entityId, 160))
    .filter(Boolean);
}

function profileFields(profile) {
  const result = new Map();
  for (const item of Array.isArray(profile?.fields) ? profile.fields : []) {
    const key = propertyKey(item?.definition?.key, 'remotePropertyKey');
    if (!key) continue;
    result.set(key, {
      value: item?.value,
      label: optionalText(item?.definition?.label || key, 500) || key,
      valueType: optionalText(item?.definition?.valueType, 80) || 'string'
    });
  }
  return result;
}

async function profiles(connection, spaceId, ids, cookie, fetchImpl) {
  const output = new Array(ids.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= ids.length) return;
      const id = ids[index];
      const profile = await requestData(
        connection,
        `/api/v1/spaces/${encodeURIComponent(spaceId)}/employees/${encodeURIComponent(id)}`,
        { cookie, fetchImpl }
      );
      output[index] = { id, fields: profileFields(profile) };
    }
  }
  await Promise.all(Array.from({ length: Math.min(PROFILE_CONCURRENCY, Math.max(1, ids.length)) }, worker));
  return output;
}

function selectedKeys(mapping) {
  return [...new Set([
    propertyKey(mapping.emailPropertyKey, 'emailPropertyKey'),
    propertyKey(mapping.positionPropertyKey, 'positionPropertyKey'),
    ...extraPropertyKeys(mapping.extraPropertyKeys)
  ].filter(Boolean))];
}

function validateDefinitions(definitions, mapping) {
  const available = new Set(definitions.map((item) => item.key));
  for (const key of selectedKeys(mapping)) {
    if (!available.has(key)) fail('docomator_property_not_found', { key });
  }
}

function scalar(value, max = 500) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return optionalText(value, max);
  }
  return null;
}

function upsertExtra(database, workspaceId, personId, remoteId, key, definition, field, now) {
  if (!field || field.value === null || field.value === undefined) {
    return Number(database.run(`
      DELETE FROM docomator_person_fields
      WHERE workspace_id = ? AND person_id = ? AND remote_property_key = ?
    `, workspaceId, personId, key).changes || 0);
  }
  const valueJson = JSON.stringify(field.value);
  const previous = database.get(`
    SELECT value_json FROM docomator_person_fields
    WHERE workspace_id = ? AND person_id = ? AND remote_property_key = ?
  `, workspaceId, personId, key);
  database.run(`
    INSERT INTO docomator_person_fields(
      workspace_id, person_id, remote_employee_id, remote_property_key,
      remote_property_label, value_type, value_json, last_synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, person_id, remote_property_key) DO UPDATE SET
      remote_employee_id = excluded.remote_employee_id,
      remote_property_label = excluded.remote_property_label,
      value_type = excluded.value_type,
      value_json = excluded.value_json,
      last_synced_at = excluded.last_synced_at
  `, workspaceId, personId, remoteId, key,
  definition?.label || field.label || key,
  definition?.valueType || field.valueType || 'string', valueJson, now);
  return previous?.value_json === valueJson ? 0 : 1;
}

export function listDocomatorPersonFields(database, workspaceId, personId) {
  return database.all(`
    SELECT remote_property_key, remote_property_label, value_type, value_json, last_synced_at
    FROM docomator_person_fields
    WHERE workspace_id = ? AND person_id = ?
    ORDER BY remote_property_label, remote_property_key
  `, workspaceId, personId).map((row) => {
    let value = null;
    try { value = JSON.parse(row.value_json); } catch {}
    return {
      key: row.remote_property_key,
      label: row.remote_property_label,
      valueType: row.value_type,
      value,
      lastSyncedAt: row.last_synced_at
    };
  });
}

export async function importDocomatorPeopleWithFields(database, workspaceId, input, {
  actorPersonId = null,
  fetchImpl = globalThis.fetch
} = {}) {
  const mapping = {
    emailPropertyKey: propertyKey(input.emailPropertyKey, 'emailPropertyKey'),
    positionPropertyKey: propertyKey(input.positionPropertyKey, 'positionPropertyKey'),
    extraPropertyKeys: extraPropertyKeys(input.extraPropertyKeys)
  };
  if (selectedKeys(mapping).length === 0) {
    const result = await importDocomatorPeople(database, workspaceId, input, { actorPersonId, fetchImpl });
    saveDocomatorFieldMapping(database, workspaceId, mapping);
    return { ...result, fieldStats: { mapped: 0, extras: 0 }, fieldMapping: mapping };
  }

  const connection = normalizeDocomatorConnection(input);
  const spaceId = optionalText(input.spaceId, 160);
  if (!spaceId) fail('docomator_remote_id_required', { field: 'spaceId' });
  const active = await session(connection, input.accessCode, fetchImpl);
  if (!active.spaces.some((space) => String(space?.id) === spaceId)) {
    fail('docomator_space_not_found', { spaceId });
  }
  const definitions = await propertyDefinitions(connection, spaceId, active.cookie, fetchImpl);
  validateDefinitions(definitions, mapping);
  const ids = await remotePeopleIds(connection, input, active.cookie, fetchImpl);
  const remoteProfiles = await profiles(connection, spaceId, ids, active.cookie, fetchImpl);

  const base = await importDocomatorPeople(database, workspaceId, input, { actorPersonId, fetchImpl });
  const byKey = new Map(definitions.map((item) => [item.key, item]));
  const now = new Date().toISOString();
  const stats = { mapped: 0, extras: 0 };
  database.transaction(() => {
    saveDocomatorFieldMapping(database, workspaceId, mapping, now);
    for (const remote of remoteProfiles) {
      const link = database.get(`
        SELECT person_id FROM docomator_person_links
        WHERE workspace_id = ? AND remote_employee_id = ?
      `, workspaceId, remote.id);
      if (!link?.person_id) continue;
      const current = database.get('SELECT email, position FROM people WHERE workspace_id = ? AND id = ?', workspaceId, link.person_id);
      const email = mapping.emailPropertyKey ? scalar(remote.fields.get(mapping.emailPropertyKey)?.value) : null;
      const position = mapping.positionPropertyKey ? scalar(remote.fields.get(mapping.positionPropertyKey)?.value) : null;
      if (email && email !== current?.email) stats.mapped += 1;
      if (position && position !== current?.position) stats.mapped += 1;
      if (email || position) {
        database.run(`
          UPDATE people SET
            email = CASE WHEN ? IS NULL THEN email ELSE ? END,
            position = CASE WHEN ? IS NULL THEN position ELSE ? END,
            updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `, email, email, position, position, now, workspaceId, link.person_id);
      }
      for (const key of mapping.extraPropertyKeys) {
        stats.extras += upsertExtra(
          database, workspaceId, link.person_id, remote.id, key,
          byKey.get(key), remote.fields.get(key), now
        );
      }
    }
    database.run(`
      INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
      VALUES (?, ?, ?, 'docomator.people.fields.sync', 'integration', 'docomator', ?, ?)
    `, newId('audit'), workspaceId, actorPersonId || 'operator', JSON.stringify({
      spaceId,
      groupId: input.groupId || null,
      fieldMapping: mapping,
      fieldStats: stats
    }), now);
  });
  return { ...base, fieldStats: stats, fieldMapping: getDocomatorFieldMapping(database, workspaceId) };
}
