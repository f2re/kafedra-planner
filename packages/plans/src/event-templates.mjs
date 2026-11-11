import { createHash } from 'node:crypto';
import { newId } from '../../core/src/ids.mjs';
import { AppError } from '../../core/src/errors.mjs';
import { requireAuthenticated } from '../../auth/src/policy.mjs';

const SOURCES = new Set(['title', 'date', 'responsible', 'location', 'activity', 'result', 'note', 'custom']);
const TYPES = new Set(['text', 'date', 'number', 'select']);
const CUSTOM_KEY = /^custom_[a-zA-Z0-9_-]{1,90}$/u;
const DEFAULTS = {
  title: ['Мероприятие', 40], date: ['Срок', 20], responsible: ['Исполнитель', 20], location: ['Место', 20]
};

function fail(code, message, status = 400, details) { throw new AppError(code, message, status, details); }
function object(value, code = 'event_template_input_invalid') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code, 'Передайте поля настройки.');
  return value;
}
function text(value, max, field, { empty = false } = {}) {
  if (typeof value !== 'string') fail('event_template_field_invalid', 'Проверьте текстовое поле.', 400, { field });
  const result = value.trim();
  if ((!empty && !result) || result.length > max) fail('event_template_field_invalid', 'Поле пустое или слишком длинное.', 400, { field, max });
  return result;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function hash(value) { return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }

export function defaultEventTemplateDefinition() {
  return {
    fields: Object.entries(DEFAULTS).map(([source, [label, width]]) => ({
      key: source, label, source, type: 'text', required: source === 'title' || source === 'date', visible: true, width
    })),
    layout: { orientation: 'landscape', showRowNumbers: true }
  };
}

export function normalizeEventTemplateDefinition(input) {
  object(input);
  if (!Array.isArray(input.fields) || input.fields.length < 2 || input.fields.length > 20) {
    fail('event_template_fields_invalid', 'В шаблоне должно быть от 2 до 20 полей.');
  }
  const keys = new Set();
  const fields = input.fields.map((field, index) => {
    object(field);
    const source = field.source;
    if (!SOURCES.has(source)) fail('event_template_source_invalid', 'Выберите источник поля.', 400, { index });
    const key = text(field.key, 100, 'key');
    if ((source === 'custom' ? !CUSTOM_KEY.test(key) : key !== source) || keys.has(key)) {
      fail('event_template_key_invalid', 'У каждого поля должен быть уникальный постоянный ключ.', 400, { index, key });
    }
    keys.add(key);
    const type = field.type ?? 'text';
    if (!TYPES.has(type) || (source !== 'custom' && type !== 'text')) {
      fail('event_template_type_invalid', 'Проверьте тип дополнительного поля.', 400, { key });
    }
    for (const prop of ['required', 'visible']) {
      if (field[prop] !== undefined && typeof field[prop] !== 'boolean') fail('event_template_field_invalid', 'Проверьте настройку поля.', 400, { key, field: prop });
    }
    const required = field.required ?? (source === 'title' || source === 'date');
    const visible = field.visible ?? true;
    if ((source === 'title' || source === 'date') && (!visible || !required)) {
      fail('event_template_core_field_required', 'Название и срок должны оставаться видимыми обязательными полями.');
    }
    if (source === 'responsible' && required) fail('event_template_executor_optional', 'Исполнитель остаётся необязательным.');
    const width = field.width === undefined ? (DEFAULTS[source]?.[1] || 20) : Number(field.width);
    if (!Number.isFinite(width) || width < 5 || width > 100) fail('event_template_width_invalid', 'Ширина поля должна быть от 5 до 100.', 400, { key });
    const normalized = { key, label: text(field.label, 120, 'label'), source, type, required, visible, width };
    if (type === 'select') {
      if (!Array.isArray(field.options) || field.options.length < 1 || field.options.length > 40) {
        fail('event_template_options_invalid', 'Добавьте от 1 до 40 вариантов выбора.', 400, { key });
      }
      normalized.options = field.options.map((value) => text(value, 120, 'option'));
      if (new Set(normalized.options).size !== normalized.options.length) fail('event_template_options_invalid', 'Варианты выбора не должны повторяться.', 400, { key });
    }
    return normalized;
  });
  if (!keys.has('title') || !keys.has('date')) fail('event_template_core_field_required', 'Добавьте название и срок мероприятия.');
  const layout = input.layout === undefined ? {} : object(input.layout);
  const orientation = layout.orientation ?? 'landscape';
  if (!['portrait', 'landscape'].includes(orientation)) fail('event_template_layout_invalid', 'Выберите ориентацию страницы.');
  if (layout.showRowNumbers !== undefined && typeof layout.showRowNumbers !== 'boolean') fail('event_template_layout_invalid', 'Проверьте настройку нумерации.');
  return { fields, layout: { orientation, showRowNumbers: layout.showRowNumbers ?? true } };
}

export function normalizeEventCustomValues(input, definition, { nullable = true, existingValues = {} } = {}) {
  object(input, 'event_custom_values_invalid');
  const fields = new Map((definition?.fields || []).filter((field) => field.source === 'custom').map((field) => [field.key, field]));
  const entries = Object.entries(input);
  if (entries.length > 20) fail('event_custom_values_invalid', 'Слишком много дополнительных полей.');
  return Object.fromEntries(entries.map(([key, raw]) => {
    const field = fields.get(key);
    if (!field) fail('event_custom_field_unknown', 'Дополнительное поле отсутствует в выбранной версии шаблона.', 400, { key });
    if (raw === null && nullable) return [key, null];
    if (!['string', 'number'].includes(typeof raw) || (typeof raw === 'number' && !Number.isFinite(raw))) {
      fail('event_custom_value_invalid', 'Проверьте значение дополнительного поля.', 400, { key });
    }
    const value = String(raw).trim();
    if (value.length > 4000) fail('event_custom_value_invalid', 'Значение поля слишком длинное.', 400, { key });
    if (value && field.type === 'date') {
      if (!/^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/u.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
        fail('event_custom_date_invalid', 'Укажите существующую дату в формате ГГГГ-ММ-ДД.', 400, { key });
      }
    }
    if (value && field.type === 'number' && (!/^-?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/u.test(value) || !Number.isFinite(Number(value.replace(',', '.'))))) {
      fail('event_custom_number_invalid', 'Введите число.', 400, { key });
    }
    if (value && field.type === 'select' && !field.options.includes(value)
      && !(Object.hasOwn(existingValues, key) && existingValues[key] === value)) {
      fail('event_custom_option_invalid', 'Выберите значение из списка.', 400, { key });
    }
    return [key, field.type === 'number' ? value.replace(',', '.') : value];
  }));
}

function actor(database, workspaceId, context) {
  requireAuthenticated(context);
  const id = context.personId || null;
  if (context.enabled && !id) fail('event_template_profile_required', 'Нужен профиль сотрудника.', 403);
  if (id && !database.get('SELECT id FROM people WHERE workspace_id = ? AND id = ?', workspaceId, id)) fail('event_template_profile_required', 'Профиль сотрудника не найден.', 403);
  return id;
}
function canRead(context, row) {
  return Boolean(context?.authenticated && (!context.enabled || context.role === 'admin' || (context.personId && context.personId === row.created_by_person_id)));
}
function templateRow(database, workspaceId, id, context) {
  requireAuthenticated(context);
  const row = database.get('SELECT * FROM plan_event_templates WHERE workspace_id = ? AND id = ?', workspaceId, id);
  if (!row) fail('event_template_not_found', 'Шаблон мероприятий не найден.', 404);
  if (!canRead(context, row)) fail('event_template_forbidden', 'Нет доступа к шаблону мероприятий.', 403);
  return row;
}
function versionDto(row) {
  return { id: row.id, templateId: row.template_id, version: row.version_no, title: row.title, definition: JSON.parse(row.definition_json), createdAt: row.created_at };
}
function audit(database, workspaceId, context, action, id, details, now) {
  database.run(`INSERT INTO audit_log(id,workspace_id,actor,action,subject_kind,subject_id,details_json,created_at)
    VALUES (?,?,?,?,'event_template',?,?,?)`, newId('audit'), workspaceId, context.personId || 'operator', action, id, JSON.stringify(details), now);
}
function assertStableFields(database, workspaceId, definition) {
  const known = new Map();
  for (const row of database.all('SELECT definition_json FROM plan_event_template_versions WHERE workspace_id = ?', workspaceId)) {
    for (const field of JSON.parse(row.definition_json).fields) known.set(field.key, field);
  }
  for (const field of definition.fields) {
    const old = known.get(field.key);
    if (old && (old.source !== field.source || old.type !== field.type)) {
      fail('event_template_field_type_immutable', 'Тип существующего поля менять нельзя. Добавьте новое поле для другого типа данных.', 409, { key: field.key });
    }
  }
}

export function getEventTemplateVersion(database, workspaceId, id, context) {
  requireAuthenticated(context);
  const row = database.get('SELECT * FROM plan_event_template_versions WHERE workspace_id = ? AND id = ?', workspaceId, id);
  if (!row) fail('event_template_version_not_found', 'Версия шаблона мероприятий не найдена.', 404);
  templateRow(database, workspaceId, row.template_id, context);
  return versionDto(row);
}

export function getEventTemplate(database, workspaceId, id, context) {
  const row = templateRow(database, workspaceId, id, context);
  const versions = database.all('SELECT * FROM plan_event_template_versions WHERE template_id = ? ORDER BY version_no DESC', id).map(versionDto);
  const currentVersion = versions.find((version) => version.id === row.current_version_id);
  if (!currentVersion) fail('event_template_version_not_found', 'Текущая версия шаблона недоступна.', 409);
  return { id: row.id, title: row.title, version: row.current_version, currentVersionId: row.current_version_id,
    definition: currentVersion.definition, currentVersion, versions, canEdit: true, updatedAt: row.updated_at };
}

export function listEventTemplates(database, workspaceId, context) {
  requireAuthenticated(context);
  const params = [workspaceId];
  const owner = context.enabled && context.role !== 'admin' ? ' AND t.created_by_person_id = ?' : '';
  if (owner) params.push(context.personId || '');
  return database.all(`SELECT t.*,v.definition_json FROM plan_event_templates t
    JOIN plan_event_template_versions v ON v.id=t.current_version_id
    WHERE t.workspace_id = ?${owner} ORDER BY t.updated_at DESC,t.id LIMIT 500`, ...params)
    .map((row) => ({ id: row.id, title: row.title, version: row.current_version, currentVersionId: row.current_version_id,
      definition: JSON.parse(row.definition_json), canEdit: true, updatedAt: row.updated_at }));
}

export function createEventTemplate(database, workspaceId, input, context, now = new Date().toISOString()) {
  object(input);
  const personId = actor(database, workspaceId, context);
  const title = text(input.title, 250, 'title');
  const definition = normalizeEventTemplateDefinition(input.definition ?? defaultEventTemplateDefinition());
  const key = text(input.idempotencyKey, 200, 'idempotencyKey');
  const requestHash = hash({ title, definition });
  return database.transaction(() => {
    const existing = database.get('SELECT * FROM plan_event_templates WHERE workspace_id=? AND idempotency_key=?', workspaceId, key);
    if (existing) {
      templateRow(database, workspaceId, existing.id, context);
      if (existing.request_hash !== requestHash) fail('event_template_idempotency_conflict', 'Этот запрос уже использован для другого шаблона.', 409);
      return { ...getEventTemplate(database, workspaceId, existing.id, context), duplicateRequest: true };
    }
    if (database.get('SELECT id FROM plan_event_template_versions WHERE workspace_id=? AND idempotency_key=?', workspaceId, key)) {
      fail('event_template_idempotency_conflict', 'Этот запрос уже использован для версии другого шаблона.', 409);
    }
    assertStableFields(database, workspaceId, definition);
    const id = newId('eventtpl');
    const versionId = newId('eventtplv');
    database.run(`INSERT INTO plan_event_templates(id,workspace_id,title,created_by_person_id,idempotency_key,request_hash,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`, id, workspaceId, title, personId, key, requestHash, now, now);
    database.run(`INSERT INTO plan_event_template_versions(id,template_id,workspace_id,version_no,title,definition_json,created_by_person_id,created_at,idempotency_key,request_hash)
      VALUES (?,?,?,1,?,?,?,?,?,?)`, versionId, id, workspaceId, title, JSON.stringify(definition), personId, now, key, requestHash);
    database.run('UPDATE plan_event_templates SET current_version_id=?,current_version=1 WHERE id=?', versionId, id);
    audit(database, workspaceId, context, 'event_template.created', id, { versionId, definition }, now);
    return { ...getEventTemplate(database, workspaceId, id, context), duplicateRequest: false };
  });
}

export function createEventTemplateVersion(database, workspaceId, id, input, context, now = new Date().toISOString()) {
  object(input);
  const personId = actor(database, workspaceId, context);
  const title = text(input.title, 250, 'title');
  const definition = normalizeEventTemplateDefinition(input.definition);
  const key = text(input.idempotencyKey, 200, 'idempotencyKey');
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) fail('event_template_version_required', 'Обновите шаблон перед сохранением.');
  const requestHash = hash({ id, title, definition, expectedVersion: input.expectedVersion });
  return database.transaction(() => {
    const template = templateRow(database, workspaceId, id, context);
    const previous = database.get('SELECT * FROM plan_event_template_versions WHERE workspace_id=? AND idempotency_key=?', workspaceId, key);
    if (previous) {
      if (previous.template_id !== id || previous.request_hash !== requestHash) fail('event_template_idempotency_conflict', 'Этот запрос уже использован для другой версии.', 409);
      return { ...getEventTemplate(database, workspaceId, id, context), savedVersion: versionDto(previous), duplicateRequest: true };
    }
    if (template.current_version !== input.expectedVersion) fail('event_template_version_conflict', 'Шаблон уже изменён. Обновите его и повторите сохранение.', 409, { version: template.current_version });
    assertStableFields(database, workspaceId, definition);
    const versionId = newId('eventtplv');
    const version = template.current_version + 1;
    database.run(`INSERT INTO plan_event_template_versions(id,template_id,workspace_id,version_no,title,definition_json,created_by_person_id,created_at,idempotency_key,request_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, versionId, id, workspaceId, version, title, JSON.stringify(definition), personId, now, key, requestHash);
    database.run('UPDATE plan_event_templates SET title=?,current_version_id=?,current_version=?,updated_at=? WHERE id=?', title, versionId, version, now, id);
    audit(database, workspaceId, context, 'event_template.version_created', id, { previousVersionId: template.current_version_id, versionId, version }, now);
    return { ...getEventTemplate(database, workspaceId, id, context), duplicateRequest: false };
  });
}
