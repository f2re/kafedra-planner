import { test, expect } from '@playwright/test';

function navigationButton(page, view) {
  const mobile = Number(page.viewportSize()?.width || 0) <= 720;
  return mobile
    ? page.locator(`.mobile-tab[data-view="${view}"]`)
    : page.locator(`.nav-item[data-view="${view}"]`);
}

async function waitDocument(page, documentId) {
  await expect.poll(async () => {
    const response = await page.request.get(`/api/documents/${documentId}`);
    if (!response.ok()) return 'missing';
    return (await response.json()).processing_status;
  }, { timeout: 20_000 }).toMatch(/processed|needs_review|failed/u);
}

async function uploadText(page, name, content) {
  const response = await page.request.post('/api/documents', {
    headers: {
      'content-type': 'text/plain',
      'x-file-name': encodeURIComponent(name),
      'x-document-type': 'auto',
      'idempotency-key': `lifecycle-browser:${name}`
    },
    data: content
  });
  expect(response.ok()).toBeTruthy();
  const result = await response.json();
  await waitDocument(page, result.documentId);
  return result.documentId;
}

async function openView(page, view) {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.kafedraSetView === 'function', null, { timeout: 12_000 });
  await navigationButton(page, view).click();
  await expect(page.locator(`[data-view-panel="${view}"]`)).toBeVisible();
}

test.beforeEach(async ({ page }, testInfo) => {
  page.on('pageerror', (error) => console.log(`[lifecycle:${testInfo.project.name}:pageerror] ${error.stack || error.message}`));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      console.log(`[lifecycle:${testInfo.project.name}:${message.type()}] ${message.text()}`);
    }
  });
});

test('Документы: понятные примеры → исправление → архив с заменой → восстановление', async ({ page }, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const oldId = await uploadText(page, `Черновой документ ${suffix}.txt`, 'Черновой документ кафедры');
  const replacementId = await uploadText(page, `Утверждённый документ ${suffix}.txt`, 'Утверждённый документ кафедры');

  await openView(page, 'documents');
  await expect(page.locator('#document-purpose-guide')).toContainText('Основание');
  await expect(page.locator('#document-purpose-guide')).toContainText('План');
  await expect(page.locator('#document-purpose-guide')).toContainText('Результат');
  await expect(page.locator('#documents-table')).not.toContainText('unknown');

  const oldRow = page.locator(`#documents-table tr[data-document-id="${oldId}"]`);
  await expect(oldRow).toBeVisible({ timeout: 15_000 });
  await oldRow.locator(`[data-lifecycle-document-edit="${oldId}"]`).click();
  await expect(page.locator('#lifecycle-document-edit-form')).toBeVisible();
  await page.locator('#lifecycle-document-edit-form [name="title"]').fill(`Исправленный документ ${suffix}`);
  await page.locator('#lifecycle-document-edit-form [name="documentType"]').selectOption('report');
  await page.locator('#lifecycle-document-edit-form button[type="submit"]').click();
  await expect(page.locator('#documents-table')).toContainText(`Исправленный документ ${suffix}`, { timeout: 15_000 });
  await expect(page.locator(`#documents-table tr[data-document-id="${oldId}"]`)).toContainText('Отчёт');

  await page.locator(`[data-lifecycle-document-archive="${oldId}"]`).click();
  await expect(page.locator('#lifecycle-archive-form')).toBeVisible();
  await expect(page.locator('#lifecycle-archive-form')).toContainText('Связи не переносятся молча');
  await page.locator('#lifecycle-archive-form [name="replacementDocumentId"]').selectOption(replacementId);
  await page.locator('#lifecycle-archive-form [name="reason"]').fill('Заменён утверждённым документом');
  await page.locator('#lifecycle-archive-form button[type="submit"]').click();

  await expect(page.locator('[data-document-lifecycle="archived"]')).toHaveClass(/active/u, { timeout: 15_000 });
  const archivedRow = page.locator(`#documents-table tr[data-document-id="${oldId}"]`);
  await expect(archivedRow).toBeVisible({ timeout: 15_000 });
  await expect(archivedRow).toContainText('Заменён');
  await expect(archivedRow).toContainText(`Утверждённый документ ${suffix}`);

  await archivedRow.locator(`[data-lifecycle-document-open="${oldId}"]`).click();
  await expect(page.locator('#ux-inspector')).toBeVisible();
  await expect(page.locator('#ux-inspector-body')).toContainText('Архивирование не удаляет файл');
  await page.locator(`#ux-inspector-actions [data-lifecycle-document-restore="${oldId}"]`).click();
  await expect(page.locator('[data-document-lifecycle="active"]')).toHaveClass(/active/u, { timeout: 15_000 });
  await expect(page.locator(`#documents-table tr[data-document-id="${oldId}"]`)).toContainText('В работе');
});

test('Планы: архивирование показывает влияние и не перепривязывает пункты и календарь', async ({ page }, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const firstResponse = await page.request.post('/api/plans', { data: {
    title: `План для архива ${suffix}`, planKind: 'department', periodKind: 'calendar', yearStart: 2026
  }});
  expect(firstResponse.ok()).toBeTruthy();
  const first = await firstResponse.json();
  const secondResponse = await page.request.post('/api/plans', { data: {
    title: `Новый план ${suffix}`, planKind: 'department', periodKind: 'calendar', yearStart: 2027
  }});
  expect(secondResponse.ok()).toBeTruthy();
  const second = await secondResponse.json();
  const itemResponse = await page.request.post(`/api/plans/${first.id}/items`, { data: {
    title: `Контрольное мероприятие ${suffix}`,
    dueDate: '2026-12-20', direction: 'organizational', executionMode: 'track'
  }});
  expect(itemResponse.ok()).toBeTruthy();
  const item = await itemResponse.json();

  await openView(page, 'plans');
  await expect(page.locator('#plans-lifecycle-guide')).toContainText('Создайте или загрузите план');
  await page.locator(`.plan-card[data-plan-id="${first.id}"]`).click();
  await expect(page.locator('#plan-detail')).toContainText(`Контрольное мероприятие ${suffix}`);
  await page.locator(`[data-lifecycle-plan-archive="${first.id}"]`).click();
  await expect(page.locator('#lifecycle-archive-form')).toBeVisible();
  await expect(page.locator('#lifecycle-archive-form')).toContainText('Пункты плана');
  await expect(page.locator('#lifecycle-archive-form')).toContainText('Календарные записи');
  await page.locator('#lifecycle-archive-form [name="replacementPlanId"]').selectOption(second.id);
  await page.locator('#lifecycle-archive-form [name="reason"]').fill('Открыт новый рабочий период');
  await page.locator('#lifecycle-archive-form button[type="submit"]').click();

  await expect(page.locator('#plans-lifecycle-status')).toHaveValue('archived', { timeout: 15_000 });
  await page.locator(`.plan-card[data-plan-id="${first.id}"]`).click();
  await expect(page.locator('#plan-detail')).toContainText('Этот план заменён');
  await expect(page.locator('#plan-detail')).toContainText(`Новый план ${suffix}`);
  await expect(page.locator('#plan-detail')).toContainText(`Контрольное мероприятие ${suffix}`);

  const calendar = await page.request.get('/api/calendar?from=2026-12-01&to=2026-12-31&limit=2000');
  expect(calendar.ok()).toBeTruthy();
  const payload = await calendar.json();
  const projected = (payload.items || []).find((candidate) => candidate.source_id === item.id);
  expect(projected).toBeTruthy();
  expect(projected.source_id).toBe(item.id);
  expect(projected.origin_id).toBe(first.id);

  await page.locator(`[data-lifecycle-plan-restore="${first.id}"]`).click();
  await expect(page.locator('#plans-lifecycle-status')).toHaveValue('active', { timeout: 15_000 });
  await expect(page.locator(`.plan-card[data-plan-id="${first.id}"]`)).toBeVisible();
});
