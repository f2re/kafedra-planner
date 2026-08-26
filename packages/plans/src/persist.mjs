import { newId } from '../../core/src/ids.mjs';
import { addSearchFragment } from '../../storage/src/search.mjs';
import { getPlan } from './queries.mjs';
import { planKindLabel, planLabel } from './shared.mjs';
import { addFacet, addReview, documentForVersion, findPerson, insertCalendarItem } from './persist-helpers.mjs';
import { linkPlanItemsToSourceRows, persistPlanSourceRows } from './source-rows.mjs';
import { autoAssignImportedPlanItem } from './auto-assignment.mjs';

export function persistPlan(database, {
  workspaceId,
  documentVersionId,
  documentTitle,
  result,
  now = new Date().toISOString()
}) {
  const existing = database.get(`
    SELECT id FROM plans WHERE workspace_id = ? AND source_document_version_id = ?
  `, workspaceId, documentVersionId);
  if (existing) return getPlan(database, workspaceId, existing.id);
  const sourceDocument = documentForVersion(database, workspaceId, documentVersionId);
  if (!sourceDocument) throw new Error('plan_source_document_not_found');

  return database.transaction(() => {
    const owner = result.ownerRaw ? findPerson(database, workspaceId, result.ownerRaw) : null;
    const planId = newId('plan');
    database.run(`
      INSERT INTO plans(
        id, workspace_id, source_document_version_id, plan_kind, period_kind, period_key,
        year_start, year_end, owner_person_id, owner_raw, title, status,
        confidence, evidence_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
    `, planId, workspaceId, documentVersionId, result.kind,
    result.periodKind || 'unknown', result.periodKey || null,
    result.yearStart || null, result.yearEnd || null, owner?.id || null,
    result.ownerRaw || null, result.title || documentTitle || sourceDocument.title,
    result.confidence || 0, JSON.stringify(result.evidence || {}), now, now);

    const persistedPlan = {
      id: planId,
      plan_kind: result.kind,
      period_key: result.periodKey,
      source_document_id: sourceDocument.id
    };
    addFacet(database, workspaceId, 'plan', planId, 'kind', result.kind, now);
    addFacet(database, workspaceId, 'plan', planId, 'period', result.periodKey, now);
    addFacet(database, workspaceId, 'plan', planId, 'owner', result.ownerRaw, now);
    addFacet(database, workspaceId, 'plan', planId, 'status', 'active', now);
    addSearchFragment(database, {
      workspaceId,
      sourceKind: 'plan',
      sourceId: planId,
      documentVersionId,
      title: planLabel(persistedPlan),
      content: [result.title, result.periodKey, result.ownerRaw, ...(result.items || []).map((item) => item.title)].filter(Boolean).join('\n'),
      locator: result.evidence?.period || { kind: 'plan', planId }
    });

    persistPlanSourceRows(database, planId, result.sourceRows || [], now);

    const missingDates = [];
    for (const item of result.items || []) {
      const responsible = item.responsibleRaw ? findPerson(database, workspaceId, item.responsibleRaw) : null;
      const itemId = newId('planitem');
      database.run(`
        INSERT INTO plan_items(
          id, plan_id, source_item_key, item_no, title, description,
          starts_at, ends_at, due_date, responsible_raw, responsible_person_id,
          direction, expected_result, status, confidence, evidence_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?)
      `, itemId, planId, item.sourceItemKey, item.itemNo || null, item.title,
      item.description || null, item.startsAt || null, item.endsAt || null, item.dueDate || null,
      item.responsibleRaw || null, responsible?.id || null, item.direction || 'organizational',
      item.expectedResult || null, item.confidence || 0, JSON.stringify(item.evidence || {}), now, now);

      addFacet(database, workspaceId, 'plan_item', itemId, 'plan_kind', result.kind, now);
      addFacet(database, workspaceId, 'plan_item', itemId, 'period', result.periodKey, now);
      addFacet(database, workspaceId, 'plan_item', itemId, 'direction', item.direction, now);
      addFacet(database, workspaceId, 'plan_item', itemId, 'responsible', item.responsibleRaw, now);
      addFacet(database, workspaceId, 'plan_item', itemId, 'date', item.dueDate || item.startsAt, now);
      addSearchFragment(database, {
        workspaceId,
        sourceKind: 'plan_item',
        sourceId: itemId,
        documentVersionId,
        title: item.title,
        content: [item.description, item.responsibleRaw, item.expectedResult, result.periodKey, planKindLabel(result.kind)].filter(Boolean).join('\n'),
        locator: item.evidence?.locator || {}
      });

      const storedItem = { ...item, id: itemId };
      if (item.startsAt) {
        insertCalendarItem(database, {
          workspaceId, plan: { ...persistedPlan, id: planId }, planItemId: itemId,
          item: storedItem, documentId: sourceDocument.id, startsAt: item.startsAt,
          endsAt: item.endsAt || null, title: item.title, kind: 'event', status: 'confirmed',
          reminderMinutes: null, now
        });
      }
      if (item.dueDate) {
        insertCalendarItem(database, {
          workspaceId, plan: { ...persistedPlan, id: planId }, planItemId: itemId,
          item: storedItem, documentId: sourceDocument.id, startsAt: item.dueDate,
          title: item.startsAt ? `Срок: ${item.title}` : item.title,
          kind: 'task', status: 'open', reminderMinutes: 10080, now
        });
      }
      if (responsible) autoAssignImportedPlanItem(database, workspaceId, itemId, now);
      if (!item.startsAt && !item.dueDate) missingDates.push({ id: itemId, title: item.title, sourceItemKey: item.sourceItemKey });
    }

    linkPlanItemsToSourceRows(database, planId, now);

    if (missingDates.length) {
      addReview(database, workspaceId, documentVersionId, 'plan_items_without_date',
        'В плане есть пункты без однозначного срока',
        `${missingDates.length} пункт(а/ов) сохранены, но не добавлены в календарь: срок отсутствует или задан неоднозначно.`,
        'Уточните сроки по исходному документу; остальные пункты плана уже импортированы.',
        { planId, items: missingDates }, now);
    }
    if (!(result.items || []).length) {
      addReview(database, workspaceId, documentVersionId, 'plan_items_missing',
        'Не удалось выделить пункты плана',
        'Документ определён как план, но строки мероприятий не распознаны надёжно.',
        'Проверьте структуру документа или настройте шаблон плана.', { planId }, now);
    }
    if (!result.periodKey || result.periodKind === 'unknown') {
      addReview(database, workspaceId, documentVersionId, 'plan_period_uncertain',
        'Не определён период плана',
        'План сохранён, но учебный или календарный год не найден с достаточной уверенностью.',
        'Укажите период по исходному документу.', { planId, evidence: result.evidence?.period || null }, now);
    }
    if (result.kind === 'personal' && result.ownerRaw && !owner) {
      addReview(database, workspaceId, documentVersionId, 'plan_owner_unresolved',
        'Не удалось сопоставить владельца личного плана',
        `В документе указан «${result.ownerRaw}», но точного сотрудника в справочнике нет.`,
        'Выберите сотрудника из справочника; извлечённое значение сохранено как доказательство.',
        { planId, ownerRaw: result.ownerRaw }, now);
    }
    if (result.kind === 'personal' && !result.ownerRaw) {
      addReview(database, workspaceId, documentVersionId, 'plan_owner_missing',
        'Не определён владелец личного плана',
        'Личный план сохранён, но ФИО владельца не удалось извлечь однозначно.',
        'Укажите сотрудника по исходному документу.', { planId }, now);
    }
    if ((result.evidence?.kind?.confidence || 0) < 0.6) {
      addReview(database, workspaceId, documentVersionId, 'plan_kind_uncertain',
        'Требуется проверить вид плана',
        `Автоматически выбран вид «${planKindLabel(result.kind)}», но в документе недостаточно явных признаков.`,
        'Подтвердите вид плана по заголовку исходного документа.', { planId, kind: result.kind }, now);
    }

    return getPlan(database, workspaceId, planId);
  });
}
