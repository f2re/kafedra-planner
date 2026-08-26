import { test, expect } from '@playwright/test';

function navigationButton(page, view) {
  const mobile = Number(page.viewportSize()?.width || 0) <= 720;
  return mobile
    ? page.locator(`.mobile-tab[data-view="${view}"]`)
    : page.locator(`.nav-item[data-view="${view}"]`);
}

async function uploadTextDocument(page, name, body) {
  const response = await page.request.post('/api/documents', {
    headers: {
      'content-type': 'text/plain',
      'x-file-name': encodeURIComponent(name),
      'x-document-type': 'other',
      'idempotency-key': `lifecycle-browser:${name}`
    },
    data: body
  });
  expect(response.ok()).toBeTruthy();
  return await response.json();
}

async function createPlan(page, title, year) {
  const response = await page.request.post('/api/plans', {
    data: {
      title,
      planKind: 'department',
      periodKind: 'calendar',
      yearStart: year,
      accessScope: 'workspace'
    }
  });
  expect(response.ok()).toBeTruthy();
  return await response.json();
}

test.beforeEach(async ({ page }, testInfo) => {
  page.on('pageerror', (error) => console.log(`[lifecycle:${testInfo.project.name}:pageerror] ${error.stack || error.message}`));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      console.log(`[lifecycle:${testInfo.project.name}:${message.type()}] ${message.text()}`);
    }
  });
});

test('Документы и планы: переименование → impact → замена → архив → восстановление', async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/giu, '-');
  const originalDocument = await uploadTextDocument(
    page, `lifecycle-original-${suffix}.txt`, 'Первоначальная редакция документа.'
  );
  const replacementDocument = await uploadTextDocument(
    page, `lifecycle-replacement-${suffix}.txt`, 'Исправленная редакция документа.'
  );
  const originalPlan = await createPlan(page, `Первоначальный план ${suffix}`, 2027);
  const replacementPlan = await createPlan(page, `Новый план ${suffix}`, 2027);

  await page.goto('/');
  await page.waitForFunction(() => typeof window.kafedraSetView === 'function', null, { timeout: 15_000 });

  await navigationButton(page, 'documents').click();
  await expect(page.locator('[data-view-panel="documents"]')).toBeVisible();
  await expect(page.locator('.lifecycle-guide')).toContainText('Основание');
  await expect(page.locator('#lifecycle-documents-toolbar')).toBeVisible();

  const originalCard = page.locator(`[data-lifecycle-document-id="${originalDocument.documentId}"]`);
  await expect(originalCard).toBeVisible({ timeout: 15_000 });
  await originalCard.locator('[data-lifecycle-document-edit]').click();
  await expect(page.locator('#lifecycle-document-edit-form')).toBeVisible();
  await page.locator('#lifecycle-document-edit-form [name="title"]').fill(`Уточнённый документ ${suffix}`);
  await page.locator('#lifecycle-document-edit-form [name="displayKind"]').selectOption('basis');
  await page.locator('#lifecycle-document-edit-form button[type="submit"]').click();
  await expect(page.locator(`[data-lifecycle-document-id="${originalDocument.documentId}"]`))
    .toContainText(`Уточнённый документ ${suffix}`, { timeout: 15_000 });

  await page.locator(`[data-lifecycle-document-id="${originalDocument.documentId}"] [data-lifecycle-document-archive]`).click();
  await expect(page.locator('#lifecycle-document-archive-form')).toBeVisible();
  await expect(page.locator('#lifecycle-document-archive-form')).toContainText('Исторические ссылки');
  await page.locator('#lifecycle-document-archive-form [name="replacementDocumentId"]')
    .selectOption(replacementDocument.documentId);
  await page.locator('#lifecycle-document-archive-form [name="reason"]')
    .fill('Загружена исправленная редакция');
  await page.locator('#lifecycle-document-archive-form button[type="submit"]').click();
  await expect(page.locator(`[data-lifecycle-document-id="${originalDocument.documentId}"]`)).toHaveCount(0, { timeout: 15_000 });

  await page.locator('[data-lifecycle-document-status="archived"]').click();
  const archivedDocument = page.locator(`[data-lifecycle-document-id="${originalDocument.documentId}"]`);
  await expect(archivedDocument).toBeVisible({ timeout: 15_000 });
  await expect(archivedDocument).toContainText('Заменён');
  await expect(archivedDocument).toContainText(`lifecycle-replacement-${suffix}`);
  await archivedDocument.locator('[data-lifecycle-document-restore]').click();
  await expect(page.locator('#lifecycle-document-restore-form')).toBeVisible();
  await page.locator('#lifecycle-document-restore-form button[type="submit"]').click();
  await expect(archivedDocument).toHaveCount(0, { timeout: 15_000 });
  await page.locator('[data-lifecycle-document-status="active"]').click();
  await expect(page.locator(`[data-lifecycle-document-id="${originalDocument.documentId}"]`)).toBeVisible({ timeout: 15_000 });

  await navigationButton(page, 'plans').click();
  await expect(page.locator('[data-view-panel="plans"]')).toBeVisible();
  await expect(page.locator('.lifecycle-plan-guide')).toContainText('Создать или загрузить');
  const originalPlanCard = page.locator(`.plan-card[data-plan-id="${originalPlan.id}"]`);
  await expect(originalPlanCard).toBeVisible({ timeout: 15_000 });
  await originalPlanCard.click();
  await expect(page.locator('[data-lifecycle-plan-controls]')).toBeVisible({ timeout: 15_000 });
  await page.locator(`[data-lifecycle-plan-edit="${originalPlan.id}"]`).click();
  await page.locator('#lifecycle-plan-edit-form [name="title"]').fill(`Уточнённый план ${suffix}`);
  await page.locator('#lifecycle-plan-edit-form button[type="submit"]').click();
  await expect(page.locator(`.plan-card[data-plan-id="${originalPlan.id}"]`))
    .toContainText(`Уточнённый план ${suffix}`, { timeout: 15_000 });

  await page.locator(`.plan-card[data-plan-id="${originalPlan.id}"]`).click();
  await page.locator(`[data-lifecycle-plan-archive="${originalPlan.id}"]`).click();
  await expect(page.locator('#lifecycle-plan-archive-form')).toBeVisible();
  await expect(page.locator('#lifecycle-plan-archive-form')).toContainText('Пункты плана');
  await page.locator('#lifecycle-plan-archive-form [name="replacementPlanId"]')
    .selectOption(replacementPlan.id);
  await page.locator('#lifecycle-plan-archive-form [name="reason"]')
    .fill('Утверждён новый план');
  await page.locator('#lifecycle-plan-archive-form button[type="submit"]').click();
  await expect(page.locator(`.plan-card[data-plan-id="${originalPlan.id}"]`)).toHaveCount(0, { timeout: 15_000 });

  await page.locator('[data-lifecycle-plan-status="archived"]').click();
  const archivedPlanCard = page.locator(`.plan-card[data-plan-id="${originalPlan.id}"]`);
  await expect(archivedPlanCard).toBeVisible({ timeout: 15_000 });
  await expect(archivedPlanCard).toContainText('Заменён');
  await expect(archivedPlanCard).toContainText(`Новый план ${suffix}`);
  await archivedPlanCard.click();
  await expect(page.locator(`[data-lifecycle-plan-restore="${originalPlan.id}"]`)).toBeVisible({ timeout: 15_000 });
  await page.locator(`[data-lifecycle-plan-restore="${originalPlan.id}"]`).click();
  await page.locator('#lifecycle-plan-restore-form button[type="submit"]').click();
  await expect(archivedPlanCard).toHaveCount(0, { timeout: 15_000 });
  await page.locator('[data-lifecycle-plan-status="active"]').click();
  await expect(page.locator(`.plan-card[data-plan-id="${originalPlan.id}"]`)).toBeVisible({ timeout: 15_000 });
});
