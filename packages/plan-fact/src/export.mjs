import { listCorrectedPlanFact } from './corrections.mjs';

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function personNames(items = []) {
  return items
    .map((person) => person.display_name || person.executor_raw)
    .filter(Boolean)
    .join(', ');
}

function correctionReasons(metric) {
  return [metric.targetCorrection?.reason, metric.actualCorrection?.reason]
    .filter(Boolean)
    .join(' | ');
}

function itemRows(item) {
  const base = {
    type: item.sourceKind === 'periodic_task' ? 'Периодическая задача' : 'Поручение',
    id: item.id,
    title: item.title,
    documentNumber: item.documentNumber || '',
    owners: personNames(item.owners),
    managers: personNames(item.controllers),
    direction: item.direction || '',
    status: item.status || '',
    risk: item.risk?.label || '',
    dueDate: item.dueDate || '',
    progress: item.progressPercent ?? ''
  };
  if (!item.metrics?.length) return [{ ...base }];
  return item.metrics.map((metric) => ({
    ...base,
    metric: metric.name,
    target: metric.targetNumeric ?? metric.targetText ?? '',
    actual: metric.actualNumeric ?? metric.actualText ?? '',
    unit: metric.unit || '',
    attainment: metric.attainmentPercent ?? '',
    delta: metric.delta ?? '',
    machineTarget: metric.machineTargetNumeric ?? metric.targetNumeric ?? '',
    machineActual: metric.machineActualNumeric ?? metric.actualNumeric ?? '',
    corrected: metric.corrected ? 'Да' : 'Нет',
    correctionReason: correctionReasons(metric)
  }));
}

export function buildPlanFactExport(database, workspaceId, filters = {}, now = new Date()) {
  const result = listCorrectedPlanFact(
    database,
    workspaceId,
    { ...filters, limit: Math.min(2000, Number(filters.limit || 2000)) },
    now
  );
  return {
    generatedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    filters,
    summary: result.summary,
    items: result.items
  };
}

export function planFactExportJson(database, workspaceId, filters = {}, now = new Date()) {
  return JSON.stringify(buildPlanFactExport(database, workspaceId, filters, now), null, 2);
}

export function planFactExportCsv(database, workspaceId, filters = {}, now = new Date()) {
  const exportData = buildPlanFactExport(database, workspaceId, filters, now);
  const headers = [
    'Тип',
    'ID',
    'Название',
    'Номер',
    'Исполнитель',
    'Руководитель',
    'Направление',
    'Статус',
    'Риск',
    'Срок',
    'Прогресс, %',
    'Показатель',
    'План',
    'Факт',
    'Единица',
    'Исполнение, %',
    'Отклонение',
    'План: машинное значение',
    'Факт: машинное значение',
    'Исправлено вручную',
    'Причина исправления'
  ];
  const rows = exportData.items.flatMap(itemRows);
  const values = rows.map((row) => [
    row.type,
    row.id,
    row.title,
    row.documentNumber,
    row.owners,
    row.managers,
    row.direction,
    row.status,
    row.risk,
    row.dueDate,
    row.progress,
    row.metric,
    row.target,
    row.actual,
    row.unit,
    row.attainment,
    row.delta,
    row.machineTarget,
    row.machineActual,
    row.corrected,
    row.correctionReason
  ]);
  return `\uFEFF${[headers, ...values].map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`;
}
