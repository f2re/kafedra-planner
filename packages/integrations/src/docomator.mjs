import { newId } from '../../core/src/ids.mjs';
import { createPerson, normalizePersonName } from '../../work-management/src/service.mjs';

const DEFAULT_PORT = 8080;
const DEFAULT_TIMEOUT_MS = 6_000;
const MAX_REMOTE_ITEMS = 1_000;
const ACCESS_CODE_PATTERN = /^\d{4}$/u;
const DOCOMATOR_SERVICES = new Set(['api', 'docomator', 'docomator-api']);
const READY_STATUSES = new Set(['ok', 'ready']);
const DEFAULT_PROTOCOL_PORTS = { http: 80, https: 443 };

export class DocomatorIntegrationError extends Error {
  constructor(code, details = null) {
    super(code);
    this.name = 'DocomatorIntegrationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, details = null) {
  throw new DocomatorIntegrationError(code, details);
}

function optionalText(value, max = 160) {
  const result = String(value ?? '').trim();
  if (!result) return null;
  if (result.length > max) fail('docomator_value_too_long', { max });
  return result;
}

function requiredRemoteId(value, field) {
  const result = optionalText(value, 160);
  if (!result) fail('docomator_remote_id_required', { field });
  return result;
}

function normalizeScheme(value) {
  const scheme = String(value || 'http').trim().toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') fail('docomator_scheme_invalid');
  return scheme;
}

function normalizeHost(value) {
  const host = String(value ?? '').trim().replace(/^\[|\]$/gu, '');
  if (!host) fail('docomator_host_required');
  if (host.length > 253) fail('docomator_host_invalid');
  if (/\s|[/?#@]/u.test(host) || host.includes('://')) fail('docomator_host_invalid');
  if (host.includes(':') && !/^[0-9a-f:.]+$/iu.test(host)) fail('docomator_host_invalid');
  return host;
}

function normalizePort(value, fallback = DEFAULT_PORT) {
  const port = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) fail('docomator_port_invalid');
  return port;
}

function endpointHost(host) {
  return host.includes(':') ? `[${host}]` : host;
}

function connectionResult(scheme, host, port) {
  const baseUrl = `${scheme}://${endpointHost(host)}:${port}`;
  return { scheme, host, port, baseUrl, url: baseUrl };
}

function explicitPort(raw) {
  const withoutScheme = raw.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u, '');
  const authority = withoutScheme.split('/', 1)[0];
  const bracketed = authority.match(/^\[[^\]]+\]:(\d+)$/u);
  if (bracketed) return Number(bracketed[1]);
  if ((authority.match(/:/gu) || []).length === 1) {
    const match = authority.match(/:(\d+)$/u);
    if (match) return Number(match[1]);
  }
  return null;
}

function withDefaultScheme(raw) {
  const slash = raw.indexOf('/');
  const authority = slash === -1 ? raw : raw.slice(0, slash);
  const suffix = slash === -1 ? '' : raw.slice(slash);
  if (!authority.startsWith('[') && (authority.match(/:/gu) || []).length >= 2) {
    return `http://[${authority}]${suffix}`;
  }
  return `http://${raw}`;
}

function assertKnownPath(pathname) {
  const normalized = pathname.replace(/\/+$/gu, '') || '/';
  if (
    normalized === '/'
    || normalized === '/healthz'
    || normalized === '/readyz'
    || normalized === '/api/v1'
    || normalized.startsWith('/api/v1/')
  ) return;
  fail('docomator_url_path_invalid', { path: normalized });
}

function normalizeUrl(value) {
  const raw = optionalText(value, 2_048);
  if (!raw) fail('docomator_host_required');
  if (/\s/u.test(raw)) fail('docomator_url_invalid');
  const hasScheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(raw);
  let parsed;
  try {
    parsed = new URL(hasScheme ? raw : withDefaultScheme(raw));
  } catch {
    fail('docomator_url_invalid');
  }
  const scheme = normalizeScheme(parsed.protocol.replace(/:$/u, ''));
  if (parsed.username || parsed.password) fail('docomator_url_credentials_forbidden');
  if (parsed.search || parsed.hash) fail('docomator_url_options_forbidden');
  assertKnownPath(parsed.pathname);
  const host = normalizeHost(parsed.hostname);
  const rawPort = explicitPort(raw);
  const port = normalizePort(
    rawPort,
    hasScheme ? DEFAULT_PROTOCOL_PORTS[scheme] : DEFAULT_PORT
  );
  return connectionResult(scheme, host, port);
}

export function normalizeDocomatorConnection(input = {}) {
  if (Object.hasOwn(input, 'url')) return normalizeUrl(input.url);
  const scheme = normalizeScheme(input.scheme);
  const host = normalizeHost(input.host);
  const port = normalizePort(input.port);
  return connectionResult(scheme, host, port);
}

function transportCode(error) {
  const raw = error?.cause?.code || error?.code || '';
  const code = String(raw).toUpperCase();
  return /^[A-Z0-9_]{1,80}$/u.test(code) ? code : null;
}

export function classifyDocomatorTransportError(error) {
  const code = transportCode(error);
  const name = String(error?.name || '');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'docomator_dns_failed';
  if (code === 'ECONNREFUSED') return 'docomator_connection_refused';
  if (
    name === 'TimeoutError'
    || name === 'AbortError'
    || code === 'ETIMEDOUT'
    || code === 'UND_ERR_CONNECT_TIMEOUT'
    || code === 'UND_ERR_HEADERS_TIMEOUT'
    || code === 'UND_ERR_BODY_TIMEOUT'
  ) return 'docomator_timeout';
  if (code && /(TLS|SSL|CERT|SELF_SIGNED|UNABLE_TO_VERIFY|CERT_ALTNAME)/u.test(code)) {
    return 'docomator_tls_failed';
  }
  return 'docomator_unreachable';
}

function transportDetails(error, connection) {
  const code = transportCode(error);
  return {
    ...(code ? { transportCode: code } : {}),
    endpoint: connection.baseUrl
  };
}

function assertDocomatorService(payload, path) {
  const service = String(payload?.service || '').trim().toLowerCase();
  if (!DOCOMATOR_SERVICES.has(service)) fail('docomator_wrong_service', { path });
}

function settingsUrl(scheme, host, port) {
  if (!host) return '';
  return connectionResult(normalizeScheme(scheme), normalizeHost(host), normalizePort(port)).baseUrl;
}

function mapSettings(row) {
  if (!row) {
    return {
      url: '',
      scheme: 'http',
      host: '',
      port: DEFAULT_PORT,
      spaceId: null,
      groupId: null,
      includeInactive: false,
      lastStatus: 'unknown',
      lastCheckedAt: null,
      lastImportedAt: null,
      remoteVersion: null,
      lastError: null
    };
  }
  return {
    url: settingsUrl(row.scheme, row.host, Number(row.port)),
    scheme: row.scheme,
    host: row.host,
    port: Number(row.port),
    spaceId: row.space_id,
    groupId: row.group_id,
    includeInactive: Boolean(row.include_inactive),
    lastStatus: row.last_status,
    lastCheckedAt: row.last_checked_at,
    lastImportedAt: row.last_imported_at,
    remoteVersion: row.remote_version,
    lastError: row.last_error
  };
}

export function getDocomatorSettings(database, workspaceId) {
  return mapSettings(database.get(
    'SELECT * FROM docomator_integrations WHERE workspace_id = ?',
    workspaceId
  ));
}

export function saveDocomatorSettings(database, workspaceId, input, now = new Date().toISOString()) {
  const connection = normalizeDocomatorConnection(input);
  const spaceId = optionalText(input.spaceId, 160);
  const groupId = optionalText(input.groupId, 160);
  const includeInactive = input.includeInactive ? 1 : 0;
  database.run(`
    INSERT INTO docomator_integrations(
      workspace_id, scheme, host, port, space_id, group_id, include_inactive,
      last_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      scheme = excluded.scheme,
      host = excluded.host,
      port = excluded.port,
      space_id = excluded.space_id,
      group_id = excluded.group_id,
      include_inactive = excluded.include_inactive,
      updated_at = excluded.updated_at
  `, workspaceId, connection.scheme, connection.host, connection.port,
  spaceId, groupId, includeInactive, now, now);
  return getDocomatorSettings(database, workspaceId);
}

function setConnectionState(database, workspaceId, {
  status,
  remoteVersion = null,
  error = null,
  checkedAt = new Date().toISOString(),
  importedAt = undefined
}) {
  database.run(`
    UPDATE docomator_integrations
    SET last_status = ?, last_checked_at = ?, remote_version = ?, last_error = ?,
        last_imported_at = CASE WHEN ? IS NULL THEN last_imported_at ELSE ? END,
        updated_at = ?
    WHERE workspace_id = ?
  `, status, checkedAt, remoteVersion, error,
  importedAt === undefined ? null : importedAt,
  importedAt === undefined ? null : importedAt,
  checkedAt, workspaceId);
}

function jsonHeaders(cookie = null) {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    ...(cookie ? { cookie } : {})
  };
}

function abortSignal(timeoutMs) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(timeoutMs)
    : undefined;
}

async function remoteFetch(connection, path, {
  method = 'GET',
  body = undefined,
  cookie = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch
} = {}) {
  let response;
  try {
    response = await fetchImpl(`${connection.baseUrl}${path}`, {
      method,
      headers: jsonHeaders(cookie),
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: abortSignal(timeoutMs)
    });
  } catch (error) {
    fail(classifyDocomatorTransportError(error), transportDetails(error, connection));
  }
  const text = await response.text().catch(() => '');
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = null; }
  }
  return { response, payload, text };
}

function remoteMessage(payload, fallback = '') {
  return String(payload?.error?.message || payload?.message || fallback || '').slice(0, 500);
}

async function requestData(connection, path, options = {}) {
  const result = await remoteFetch(connection, path, options);
  if (result.response.status === 401 || result.response.status === 403) {
    fail('docomator_auth_required', { status: result.response.status });
  }
  if (!result.response.ok) {
    fail('docomator_remote_error', {
      status: result.response.status,
      message: remoteMessage(result.payload, result.text)
    });
  }
  if (!result.payload || typeof result.payload !== 'object') {
    fail('docomator_protocol_error', { path });
  }
  return result.payload.data ?? result.payload;
}

function cookieFrom(response) {
  const raw = response.headers.get('set-cookie');
  if (!raw) return null;
  return raw.split(';', 1)[0]?.trim() || null;
}

async function unlock(connection, accessCode, fetchImpl) {
  const code = String(accessCode || '').trim();
  if (!ACCESS_CODE_PATTERN.test(code)) fail('docomator_access_code_invalid');
  const result = await remoteFetch(connection, '/api/v1/access/unlock', {
    method: 'POST',
    body: { code },
    fetchImpl
  });
  if (result.response.status === 401 || result.response.status === 403) {
    fail('docomator_access_denied');
  }
  if (!result.response.ok) {
    fail('docomator_remote_error', {
      status: result.response.status,
      message: remoteMessage(result.payload, result.text)
    });
  }
  const cookie = cookieFrom(result.response);
  if (!cookie) fail('docomator_protocol_error', { path: '/api/v1/access/unlock' });
  return cookie;
}

async function dataSession(connection, accessCode, fetchImpl) {
  const spacesPath = `/api/v1/spaces?status=active&limit=${MAX_REMOTE_ITEMS}`;
  try {
    const spaces = await requestData(connection, spacesPath, { fetchImpl });
    return { cookie: null, spaces: Array.isArray(spaces) ? spaces : [], authRequired: false };
  } catch (error) {
    if (!(error instanceof DocomatorIntegrationError) || error.code !== 'docomator_auth_required') throw error;
    if (!accessCode) return { cookie: null, spaces: [], authRequired: true };
    const cookie = await unlock(connection, accessCode, fetchImpl);
    const spaces = await requestData(connection, spacesPath, { cookie, fetchImpl });
    return { cookie, spaces: Array.isArray(spaces) ? spaces : [], authRequired: false };
  }
}

function normalizeRemotePerson(item) {
  const id = optionalText(item?.id ?? item?.entityId, 160);
  const displayName = optionalText(item?.displayName ?? item?.display_name, 500);
  const status = String(item?.status || 'active');
  if (!id || !displayName) return null;
  return {
    id,
    displayName,
    status: status === 'inactive' || status === 'archived' ? status : 'active'
  };
}

async function listRemotePeople(connection, {
  spaceId,
  groupId = null,
  includeInactive = false,
  cookie = null,
  fetchImpl = globalThis.fetch
}) {
  const remoteSpaceId = encodeURIComponent(requiredRemoteId(spaceId, 'spaceId'));
  let rows;
  if (groupId) {
    const remoteGroupId = encodeURIComponent(requiredRemoteId(groupId, 'groupId'));
    rows = await requestData(
      connection,
      `/api/v1/spaces/${remoteSpaceId}/groups/${remoteGroupId}/members`,
      { cookie, fetchImpl }
    );
    rows = (Array.isArray(rows) ? rows : []).filter((item) => item?.entityTypeKey === 'person');
  } else {
    const status = includeInactive ? '' : '&status=active';
    rows = await requestData(
      connection,
      `/api/v1/spaces/${remoteSpaceId}/employees?limit=${MAX_REMOTE_ITEMS}${status}`,
      { cookie, fetchImpl }
    );
  }
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeRemotePerson)
    .filter(Boolean)
    .filter((item) => includeInactive || item.status === 'active');
}

export async function checkDocomatorConnection(input, {
  fetchImpl = globalThis.fetch
} = {}) {
  const connection = normalizeDocomatorConnection(input);
  const healthResult = await remoteFetch(connection, '/healthz', { fetchImpl });
  if (!healthResult.response.ok) {
    fail('docomator_unreachable', { status: healthResult.response.status, endpoint: connection.baseUrl });
  }
  assertDocomatorService(healthResult.payload, '/healthz');
  if (String(healthResult.payload?.status || '').toLowerCase() !== 'ok') {
    fail('docomator_wrong_service', { path: '/healthz', endpoint: connection.baseUrl });
  }

  const readyResult = await remoteFetch(connection, '/readyz', { fetchImpl });
  assertDocomatorService(readyResult.payload, '/readyz');
  const readyStatus = String(readyResult.payload?.status || '').trim().toLowerCase();
  if (!readyResult.response.ok || !READY_STATUSES.has(readyStatus)) {
    fail('docomator_not_ready', { status: readyResult.response.status, endpoint: connection.baseUrl });
  }
  const ready = true;
  const remoteVersion = optionalText(healthResult.payload?.version, 80);
  const session = await dataSession(connection, input.accessCode, fetchImpl);
  if (session.authRequired) {
    return {
      reachable: true,
      ready,
      authRequired: true,
      dataAvailable: false,
      remoteVersion,
      endpoint: connection.baseUrl,
      spaces: [],
      groups: [],
      peopleCount: null,
      peoplePreview: []
    };
  }

  const spaceId = optionalText(input.spaceId, 160);
  const groupId = optionalText(input.groupId, 160);
  let groups = [];
  let people = [];
  if (spaceId) {
    groups = await requestData(
      connection,
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/groups?limit=${MAX_REMOTE_ITEMS}`,
      { cookie: session.cookie, fetchImpl }
    );
    if (!Array.isArray(groups)) groups = [];
    people = await listRemotePeople(connection, {
      spaceId,
      groupId,
      includeInactive: Boolean(input.includeInactive),
      cookie: session.cookie,
      fetchImpl
    });
  }

  return {
    reachable: true,
    ready,
    authRequired: false,
    dataAvailable: true,
    remoteVersion,
    endpoint: connection.baseUrl,
    spaces: session.spaces,
    groups,
    peopleCount: spaceId ? people.length : null,
    peoplePreview: people.slice(0, 30)
  };
}

function upsertRemoteLink(database, workspaceId, remoteSpaceId, remote, personId, now) {
  database.run(`
    INSERT INTO docomator_person_links(
      workspace_id, remote_employee_id, person_id, remote_space_id,
      remote_display_name, remote_status, last_synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, remote_employee_id) DO UPDATE SET
      person_id = excluded.person_id,
      remote_space_id = excluded.remote_space_id,
      remote_display_name = excluded.remote_display_name,
      remote_status = excluded.remote_status,
      last_synced_at = excluded.last_synced_at
  `, workspaceId, remote.id, personId, remoteSpaceId,
  remote.displayName, remote.status, now);
}

function syncRemotePerson(database, workspaceId, remoteSpaceId, remote, now) {
  const normalizedName = normalizePersonName(remote.displayName);
  if (!normalizedName) return { kind: 'skipped', person: null };
  const linked = database.get(`
    SELECT l.person_id, p.*
    FROM docomator_person_links l
    LEFT JOIN people p ON p.id = l.person_id AND p.workspace_id = l.workspace_id
    WHERE l.workspace_id = ? AND l.remote_employee_id = ?
  `, workspaceId, remote.id);
  const sameName = database.get(`
    SELECT * FROM people WHERE workspace_id = ? AND normalized_name = ?
  `, workspaceId, normalizedName);

  let person = linked?.id ? linked : null;
  let kind = person ? 'updated' : 'matched';
  if (person && sameName && sameName.id !== person.id) {
    person = sameName;
    kind = 'matched';
  }
  if (!person && sameName) person = sameName;
  if (!person) {
    person = createPerson(database, workspaceId, { displayName: remote.displayName }, now);
    kind = 'created';
  }

  const authoritativeLink = Boolean(linked?.id);
  const desiredStatus = remote.status === 'active' ? 'active' : 'inactive';
  if (authoritativeLink || kind === 'created') {
    database.run(`
      UPDATE people
      SET display_name = ?, normalized_name = ?, status = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `, remote.displayName, normalizedName, desiredStatus, now, workspaceId, person.id);
  } else if (remote.status === 'active' && person.status !== 'active') {
    database.run(`UPDATE people SET status = 'active', updated_at = ? WHERE workspace_id = ? AND id = ?`,
      now, workspaceId, person.id);
  }
  person = database.get('SELECT * FROM people WHERE workspace_id = ? AND id = ?', workspaceId, person.id);
  upsertRemoteLink(database, workspaceId, remoteSpaceId, remote, person.id, now);
  return { kind, person };
}

function auditImport(database, workspaceId, actorPersonId, details, now) {
  database.run(`
    INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
    VALUES (?, ?, ?, 'docomator.people.import', 'integration', 'docomator', ?, ?)
  `, newId('audit'), workspaceId, actorPersonId || 'operator', JSON.stringify(details), now);
}

export async function importDocomatorPeople(database, workspaceId, input, {
  actorPersonId = null,
  fetchImpl = globalThis.fetch
} = {}) {
  const now = new Date().toISOString();
  const connection = normalizeDocomatorConnection(input);
  const spaceId = requiredRemoteId(input.spaceId, 'spaceId');
  const groupId = optionalText(input.groupId, 160);
  const includeInactive = Boolean(input.includeInactive);
  const session = await dataSession(connection, input.accessCode, fetchImpl);
  if (session.authRequired) fail('docomator_auth_required');
  if (!session.spaces.some((space) => String(space?.id) === spaceId)) {
    fail('docomator_space_not_found', { spaceId });
  }
  const remotePeople = await listRemotePeople(connection, {
    spaceId,
    groupId,
    includeInactive,
    cookie: session.cookie,
    fetchImpl
  });

  const stats = { total: remotePeople.length, created: 0, updated: 0, matched: 0, skipped: 0 };
  const imported = [];
  const skippedRemoteIds = [];
  database.transaction(() => {
    saveDocomatorSettings(database, workspaceId, {
      ...input,
      spaceId,
      groupId,
      includeInactive
    }, now);
    for (const remote of remotePeople) {
      try {
        const result = database.transaction(() => syncRemotePerson(
          database, workspaceId, spaceId, remote, now
        ));
        stats[result.kind] = (stats[result.kind] || 0) + 1;
        if (result.person) imported.push({
          id: result.person.id,
          displayName: result.person.display_name,
          status: result.person.status,
          remoteId: remote.id
        });
      } catch {
        stats.skipped += 1;
        skippedRemoteIds.push(remote.id);
      }
    }
    setConnectionState(database, workspaceId, {
      status: 'ok',
      checkedAt: now,
      importedAt: now
    });
    auditImport(database, workspaceId, actorPersonId, {
      provider: 'docomator',
      endpoint: connection.baseUrl,
      spaceId,
      groupId,
      includeInactive,
      stats,
      skippedRemoteIds: skippedRemoteIds.slice(0, 100)
    }, now);
  });
  return {
    stats,
    imported: imported.slice(0, 100),
    skippedRemoteIds: skippedRemoteIds.slice(0, 100),
    settings: getDocomatorSettings(database, workspaceId)
  };
}

export function recordDocomatorCheck(database, workspaceId, input, result, now = new Date().toISOString()) {
  saveDocomatorSettings(database, workspaceId, input, now);
  setConnectionState(database, workspaceId, {
    status: result.reachable && result.ready ? 'ok' : result.reachable ? 'degraded' : 'error',
    remoteVersion: result.remoteVersion || null,
    error: result.authRequired ? 'Требуется код доступа для чтения данных.' : null,
    checkedAt: now
  });
  return getDocomatorSettings(database, workspaceId);
}

export function recordDocomatorFailure(database, workspaceId, input, error, now = new Date().toISOString()) {
  try { saveDocomatorSettings(database, workspaceId, input, now); } catch {}
  const message = error instanceof DocomatorIntegrationError
    ? error.code
    : 'docomator_integration_failed';
  try {
    setConnectionState(database, workspaceId, {
      status: 'error',
      error: message,
      checkedAt: now
    });
  } catch {}
}
