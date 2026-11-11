import { AppError } from '../../core/src/errors.mjs';
import { newId } from '../../core/src/ids.mjs';
import { requireAuthenticated } from '../../auth/src/policy.mjs';
import { loadLlmSettings } from '../../ai/src/llm-config-store.mjs';
import { SELECTION_TASK, selectionHash, chunkSelectionCandidates, suggestPlanSelectionWithLlama } from '../../ai/src/plan-selection-task.mjs';
import { addMonthlyPlanItems, assertMonthlyPlanRevision, getMonthlyPlan, listPlanEvents,
  normalizeMonthlyPlanMonth, updateMonthlyPlanItem } from './monthly.mjs';
import { defaultEventTemplateDefinition, getEventTemplateVersion } from './event-templates.mjs';
import { loadSelectionSource, selectionSourceSnapshot } from './selection-source.mjs';
import { normalizeName, parseJson } from './shared.mjs';

const PAGE_SIZE = 60;
const pendingRequests = new WeakMap();
let modelBusy = false;
const relevanceOrder = { recommended: 0, review: 1, other: 2 };
function fail(code, message, status = 400, details) { throw new AppError(code, message, status, details); }
function fieldsObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('plan_selection_input_invalid', 'Передайте параметры подбора.');
}
function text(value, max, name, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail('plan_selection_field_invalid', 'Проверьте параметры подбора.', 400, { field: name });
  return value.trim();
}
function actor(database, workspaceId, context) {
  requireAuthenticated(context);
  const id = context.personId || null;
  if ((context.enabled && !id) || (id && !database.get('SELECT id FROM people WHERE workspace_id=? AND id=?', workspaceId, id))) {
    fail('plan_selection_profile_required', 'Нужен профиль сотрудника.', 403);
  }
  return id;
}
function normalizeInput(input) {
  fieldsObject(input);
  const department = text(input.department, 500, 'department');
  if (normalizeName(department).length < 3) fail('plan_selection_department_required', 'Укажите название кафедры для подбора.');
  const offset = input.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 50_000) fail('plan_selection_offset_invalid', 'Обновите список мероприятий.');
  if (input.includeUndated !== undefined && typeof input.includeUndated !== 'boolean') fail('plan_selection_field_invalid', 'Проверьте отбор мероприятий без срока.');
  return { month: normalizeMonthlyPlanMonth(input.month), department,
    eventTemplateVersionId: text(input.eventTemplateVersionId, 200, 'eventTemplateVersionId', true) || null,
    includeUndated: input.includeUndated !== false, planId: text(input.planId, 200, 'planId', true),
    q: text(input.q, 500, 'q', true), activityKind: text(input.activityKind, 40, 'activityKind', true), offset,
    idempotencyKey: text(input.idempotencyKey, 200, 'idempotencyKey') };
}
function definitionFor(database, workspaceId, versionId, context) {
  return versionId ? getEventTemplateVersion(database, workspaceId, versionId, context).definition : defaultEventTemplateDefinition();
}
function readableRun(database, workspaceId, runId, context) {
  requireAuthenticated(context);
  const run = database.get('SELECT * FROM plan_event_selection_runs WHERE workspace_id=? AND id=?', workspaceId, runId);
  if (!run) fail('plan_selection_not_found', 'Подбор не найден.', 404);
  if (context.enabled && context.role !== 'admin' && run.created_by_person_id !== context.personId) fail('plan_selection_forbidden', 'Нет доступа к этому подбору.', 403);
  definitionFor(database, workspaceId, run.event_template_version_id, context);
  return run;
}
function ensureNotAborted(signal) {
  if (signal?.aborted) fail('plan_selection_cancelled', 'Подбор отменён.', 409);
}

export function deterministicSelection(candidate, department) {
  const target = normalizeName(department);
  const nameOnly = target.replace(/^(?:кафедра|кафедры|кафедре|отдел|подразделение)\s+/u, '');
  const hasPhrase = (value, phrase) => ` ${normalizeName(value)} `.includes(` ${phrase} `);
  const direct = candidate.segments.find((part) => ['item:responsible', 'plan:owner', 'plan:title'].includes(part.id)
    && (hasPhrase(part.text, target) || (nameOnly.length >= 5 && /(?:^|\s)кафедр/iu.test(part.text)
      && hasPhrase(part.text, nameOnly)))
    && (part.id !== 'plan:title' || candidate.source.plan_kind === 'department' || /(?:^|\s)кафедр/iu.test(part.text)));
  const allDepartments = candidate.segments.find((part) => /(?:все(?:м|х)?|кажд(?:ой|ая))\s+кафедр/iu.test(part.text)
    && !/не\s+(?:все(?:м|х)?|кажд(?:ой|ая))\s+кафедр/iu.test(part.text));
  const mention = candidate.segments.find((part) => !part.id.startsWith('plan:') && hasPhrase(part.text, target));
  const basis = direct || allDepartments || mention || candidate.segments.find((part) => part.id === 'item:title') || candidate.segments[0];
  const relevance = direct || allDepartments ? 'recommended' : mention || candidate.source.plan_kind === 'department' ? 'review' : 'other';
  const reason = direct ? 'Кафедра указана в плане или среди исполнителей.'
    : allDepartments ? 'Мероприятие адресовано всем кафедрам.'
      : mention ? 'Кафедра упомянута; проверьте характер участия.'
        : candidate.source.plan_kind === 'department' ? 'Кафедральный план; проверьте принадлежность выбранной кафедре.'
          : 'В источнике не указано участие выбранной кафедры.';
  return { planItemId: candidate.planItemId, relevance, reason, quote: basis?.text?.slice(0, 2000) || '',
    segmentId: basis?.id || null, suggestedFields: {}, method: 'rules' };
}

function sortItems(items) {
  return items.sort((left, right) => relevanceOrder[left.relevance] - relevanceOrder[right.relevance]
    || String(left.source.due_date || left.source.starts_at || '9999').localeCompare(String(right.source.due_date || right.source.starts_at || '9999'))
    || left.source.title.localeCompare(right.source.title, 'ru') || left.planItemId.localeCompare(right.planItemId))
    .map((item, rank) => ({ ...item, rank: rank + 1 }));
}

export function getPlanSelectionRun(database, workspaceId, runId, context) {
  const run = readableRun(database, workspaceId, runId, context);
  const result = parseJson(run.result_json, {}), snapshots = new Map(parseJson(run.source_snapshot_json, []).map((item) => [item.planItemId, item]));
  const items = [], warnings = [...(result.warnings || [])];
  let unavailable = 0, changed = 0;
  for (const item of result.items || []) {
    try {
      const current = loadSelectionSource(database, workspaceId, item.planItemId, context);
      const stale = current.fingerprint !== snapshots.get(item.planItemId)?.fingerprint;
      if (stale) changed += 1;
      items.push(stale ? { ...item, source: current.source, relevance: 'review', reason: 'Источник изменился. Повторите подбор перед добавлением.',
        quote: '', suggestedFields: {}, stale: true } : { ...item, source: current.source });
    } catch (error) { if (!(error instanceof AppError)) throw error; unavailable += 1; }
  }
  if (unavailable) warnings.push(`Недоступных мероприятий: ${unavailable}. Они исключены из результата.`);
  if (changed) warnings.push(`Изменившихся мероприятий: ${changed}. Для них нужен новый подбор.`);
  return { runId: run.id, month: run.month_key, department: run.department_text,
    eventTemplateVersionId: run.event_template_version_id, method: run.method, model: run.model,
    promptVersion: run.prompt_version, createdAt: run.created_at,
    items: sortItems(items), warnings: [...new Set(warnings)], hasMore: Boolean(result.hasMore), nextOffset: result.nextOffset ?? null };
}

async function buildSelection(database, workspaceId, normalized, context, config, { fetchImpl, signal }) {
  const actorId = actor(database, workspaceId, context);
  const definition = definitionFor(database, workspaceId, normalized.eventTemplateVersionId, context);
  const { idempotencyKey, ...parameters } = normalized;
  const requestHash = selectionHash(JSON.stringify({ ...parameters, actorId }));
  const prior = database.get('SELECT id,request_hash FROM plan_event_selection_runs WHERE workspace_id=? AND idempotency_key=?', workspaceId, idempotencyKey);
  if (prior) {
    readableRun(database, workspaceId, prior.id, context);
    if (prior.request_hash !== requestHash) fail('plan_selection_idempotency_conflict', 'Этот запрос уже использован для другого подбора.', 409);
    return { ...getPlanSelectionRun(database, workspaceId, prior.id, context), duplicateRequest: true };
  }
  ensureNotAborted(signal);
  const page = listPlanEvents(database, workspaceId, context, { month: parameters.month, includeUndated: parameters.includeUndated,
    planId: parameters.planId, q: parameters.q, activityKind: parameters.activityKind, offset: parameters.offset, limit: PAGE_SIZE });
  const candidates = [], warnings = [];
  for (const item of page.items) {
    try { candidates.push(loadSelectionSource(database, workspaceId, item.id, context)); }
    catch (error) { if (!(error instanceof AppError)) throw error; warnings.push('Часть мероприятий стала недоступна и не участвовала в подборе.'); }
  }
  const proposals = new Map(candidates.map((candidate) => [candidate.planItemId, deterministicSelection(candidate, parameters.department)]));
  const settings = { ...config, ...loadLlmSettings(config.dataDir, config) };
  const options = { department: parameters.department, month: parameters.month, fields: definition.fields };
  const inputSha256 = selectionHash(JSON.stringify({ parameters, definition, sources: candidates.map(selectionSourceSnapshot) }));
  let model = null;
  if (settings.llmEnabled && settings.llmEndpoint && candidates.length) {
    if (modelBusy) warnings.push('Модель занята. Предварительный отбор выполнен по данным источников.');
    else {
      modelBusy = true;
      try {
        const { chunks, skipped } = chunkSelectionCandidates(candidates, options, settings);
        if (skipped.length) warnings.push(`Не поместилось в контекст модели: ${skipped.length}. Для этих мероприятий сохранён отбор по источникам.`);
        const deadline = Date.now() + Math.min(45_000, Math.max(1000, settings.llmTimeoutMs || 45_000));
        for (const chunk of chunks) {
          ensureNotAborted(signal);
          const remaining = deadline - Date.now();
          if (remaining < 1) { warnings.push('Время работы модели истекло. Остальные мероприятия доступны для ручного выбора.'); break; }
          const response = await suggestPlanSelectionWithLlama({ candidates: chunk, ...options,
            config: { ...settings, llmTimeoutMs: remaining }, fetchImpl, signal });
          ensureNotAborted(signal);
          for (const item of response.items || []) proposals.set(item.planItemId, item);
          if (response.items?.length) model = response.model || settings.llmModel || null;
          if (response.status === 'failed') { warnings.push('Модель недоступна или ответ не подтверждён источниками. Сохранён предварительный отбор по данным планов.'); break; }
          if (response.status === 'partial') warnings.push('Часть ответа модели не подтверждена источниками. Эти предложения не применены.');
          if ((response.items || []).length < chunk.length) warnings.push('Для части мероприятий модель не дала проверенного ответа. Они остаются в списке с отбором по источникам.');
        }
      } finally { modelBusy = false; }
    }
  } else if (!settings.llmEnabled || !settings.llmEndpoint) warnings.push('Модель выключена. Предварительный отбор выполнен по данным источников.');
  ensureNotAborted(signal);
  definitionFor(database, workspaceId, normalized.eventTemplateVersionId, context);
  const currentCandidates = [], items = [];
  for (const before of candidates) {
    try {
      const current = loadSelectionSource(database, workspaceId, before.planItemId, context);
      const unchanged = before.fingerprint === current.fingerprint;
      if (!unchanged) warnings.push('Часть источников изменилась во время подбора. Для них обновлён отбор по текущим данным.');
      currentCandidates.push(current);
      items.push({ ...(unchanged ? proposals.get(current.planItemId) : deterministicSelection(current, parameters.department)), source: current.source });
    } catch (error) { if (!(error instanceof AppError)) throw error; warnings.push('Часть мероприятий стала недоступна и исключена из результата.'); }
  }
  const llmCount = items.filter((item) => item.method === 'llm').length;
  const method = llmCount ? llmCount === items.length ? 'llm' : 'mixed' : 'rules';
  const result = { items: sortItems(items), warnings: [...new Set(warnings)], hasMore: page.hasMore, nextOffset: page.nextOffset };
  const runId = database.transaction(() => {
    const existing = database.get('SELECT id,request_hash FROM plan_event_selection_runs WHERE workspace_id=? AND idempotency_key=?', workspaceId, idempotencyKey);
    if (existing) {
      readableRun(database, workspaceId, existing.id, context);
      if (existing.request_hash !== requestHash) fail('plan_selection_idempotency_conflict', 'Этот запрос уже использован для другого подбора.', 409);
      return existing.id;
    }
    const id = newId('planselection');
    database.run(`INSERT INTO plan_event_selection_runs(id,workspace_id,created_by_person_id,event_template_version_id,
      department_text,month_key,method,model,prompt_version,input_sha256,source_snapshot_json,result_json,created_at,idempotency_key,request_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, workspaceId, actorId, normalized.eventTemplateVersionId,
    normalized.department, normalized.month, method, model, SELECTION_TASK.version, inputSha256,
    JSON.stringify(currentCandidates.map(selectionSourceSnapshot)), JSON.stringify(result), new Date().toISOString(), idempotencyKey, requestHash);
    return id;
  });
  return getPlanSelectionRun(database, workspaceId, runId, context);
}

export async function suggestPlanEvents(database, workspaceId, input, context, config = {}, { fetchImpl = fetch, signal } = {}) {
  const normalized = normalizeInput(input);
  actor(database, workspaceId, context);
  let pending = pendingRequests.get(database);
  if (!pending) { pending = new Map(); pendingRequests.set(database, pending); }
  const key = `${workspaceId}:${normalized.idempotencyKey}`;
  if (pending.has(key)) {
    const previous = pending.get(key);
    if (previous.actorId !== (context.personId || null) || previous.input !== JSON.stringify(normalized)) {
      fail('plan_selection_idempotency_conflict', 'Этот запрос уже используется для другого подбора.', 409);
    }
    await previous.promise;
    ensureNotAborted(signal);
    return buildSelection(database, workspaceId, normalized, context, config, { fetchImpl, signal });
  }
  const promise = buildSelection(database, workspaceId, normalized, context, config, { fetchImpl, signal });
  pending.set(key, { actorId: context.personId || null, input: JSON.stringify(normalized), promise });
  try { return await promise; }
  finally { pending.delete(key); }
}

export function applyPlanSelection(database, workspaceId, monthlyPlanId, input, context, now = new Date().toISOString()) {
  fieldsObject(input);
  actor(database, workspaceId, context);
  const runId = text(input.runId, 200, 'runId');
  if (!Array.isArray(input.planItemIds) || input.planItemIds.length > PAGE_SIZE || input.planItemIds.some((id) => typeof id !== 'string' || !id || id.length > 200)) {
    fail('plan_selection_items_invalid', 'Выберите мероприятия из результата подбора.');
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) fail('monthly_plan_revision_required', 'Обновите месячный план перед сохранением.');
  const ids = [...new Set(input.planItemIds)];
  return database.transaction(() => {
    const run = readableRun(database, workspaceId, runId, context);
    let draft = getMonthlyPlan(database, workspaceId, monthlyPlanId, context);
    if (draft.month_key !== run.month_key || (draft.event_template_version_id || null) !== run.event_template_version_id
      || (draft.department_text && normalizeName(draft.department_text) !== normalizeName(run.department_text))) {
      fail('plan_selection_context_changed', 'Месяц, кафедра или шаблон изменились. Повторите подбор.', 409);
    }
    const proposals = new Map(parseJson(run.result_json, {}).items?.map((item) => [item.planItemId, item]) || []);
    const snapshots = new Map(parseJson(run.source_snapshot_json, []).map((item) => [item.planItemId, item]));
    const allowed = [], outcomes = new Map(), currentSources = new Map();
    for (const id of ids) {
      try {
        if (!proposals.has(id)) fail('plan_selection_item_unknown', 'Мероприятие отсутствует в этом подборе.', 400);
        const current = loadSelectionSource(database, workspaceId, id, context);
        const existing = draft.items.find((item) => item.plan_item_id === id);
        if (existing) { outcomes.set(id, { planItemId: id, id: existing.id, status: 'existing' }); continue; }
        if (current.fingerprint !== snapshots.get(id)?.fingerprint) fail('plan_selection_source_changed', 'Мероприятие изменилось. Повторите подбор.', 409);
        allowed.push(id); currentSources.set(id, current);
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        outcomes.set(id, { planItemId: id, status: 'error', code: error.code, message: error.message });
      }
    }
    if (allowed.length) {
      assertMonthlyPlanRevision(draft, input.expectedRevision);
      const added = addMonthlyPlanItems(database, workspaceId, monthlyPlanId, { planItemIds: allowed, expectedRevision: draft.revision }, context, now);
      draft = added.draft;
      for (const result of added.results) {
        outcomes.set(result.planItemId, result);
        if (result.status !== 'added') continue;
        const proposal = proposals.get(result.planItemId), current = currentSources.get(result.planItemId);
        const patch = { expectedRevision: draft.revision }, fields = proposal.suggestedFields || {};
        if (fields.location && !current.source.location && !current.source.detailsRevision) patch.locationOverride = fields.location.value;
        const customValues = {};
        for (const [key, suggested] of Object.entries(fields.customValues || {})) {
          if (!Object.hasOwn(current.source.customValues, key)) customValues[key] = suggested.value;
        }
        if (Object.keys(customValues).length) patch.customValues = customValues;
        if (Object.keys(patch).length > 1) draft = updateMonthlyPlanItem(database, workspaceId, monthlyPlanId, result.id, patch, context, now);
        const evidence = { provenance: 'operator_accepted_selection', runId: run.id, method: proposal.method,
          model: proposal.method === 'llm' ? run.model : null, promptVersion: run.prompt_version, inputSha256: run.input_sha256,
          source: snapshots.get(result.planItemId), department: run.department_text, relevance: proposal.relevance,
          reason: proposal.reason, quote: proposal.quote, segmentId: proposal.segmentId, suggestedFields: fields,
          acceptedByPersonId: context.personId || null, acceptedAt: now };
        database.run(`UPDATE monthly_plan_items SET selection_run_id=?,selection_evidence_json=? WHERE id=? AND monthly_plan_id=?`,
          run.id, JSON.stringify(evidence), result.id, monthlyPlanId);
      }
      database.run(`INSERT INTO audit_log(id,workspace_id,actor,action,subject_kind,subject_id,details_json,created_at)
        VALUES (?,?,?,'monthly_plan.selection_applied','monthly_plan',?,?,?)`, newId('audit'), workspaceId, context.personId || 'operator', monthlyPlanId,
      JSON.stringify({ runId, planItemIds: added.results.filter((item) => item.status === 'added').map((item) => item.planItemId) }), now);
    }
    return { draft: getMonthlyPlan(database, workspaceId, monthlyPlanId, context), results: ids.map((id) => outcomes.get(id)),
      duplicateRequest: ids.length > 0 && ids.every((id) => outcomes.get(id)?.status === 'existing') };
  });
}
