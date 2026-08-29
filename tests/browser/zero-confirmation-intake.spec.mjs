import { test, expect } from '@playwright/test';

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body)
  });
}

async function waitForBridge(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof window.kafedraResolveIntakeDocument === 'function',
    null,
    { timeout: 20_000 }
  );
}

async function uploadAndWait(page, documentId) {
  return await page.evaluate(async (id) => {
    const ready = new Promise((resolve) => {
      window.addEventListener('kafedra:intake-object-ready', (event) => resolve(event.detail), { once: true });
    });
    const response = await fetch('/api/documents', {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-file-name': encodeURIComponent(`${id}.docx`)
      },
      body: new Uint8Array([80, 75, 3, 4])
    });
    if (!response.ok) throw new Error(`upload failed: ${response.status}`);
    return await ready;
  }, documentId);
}

test('DOCX-план сразу открывается как рабочий план без подтверждения импорта', async ({ page }) => {
  const documentId = 'document-grace-plan';
  const planId = 'plan-grace-ready';

  await page.route('**/api/documents', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await json(route, { documentId }, 201);
  });
  await page.route('**/api/plans?*', (route) => json(route, {
    items: [{
      id: planId,
      title: 'План кафедры на 2026 год',
      source_document_id: documentId,
      status: 'active'
    }]
  }));
  await page.route('**/api/meetings?*', (route) => json(route, { items: [] }));

  await waitForBridge(page);
  const detail = await uploadAndWait(page, documentId);

  expect(detail).toMatchObject({ documentId, kind: 'plan', objectId: planId });
  await expect(page.locator('[data-view-panel="plans"]')).toHaveClass(/active/);
  await expect(page.locator('#intake-object-notice')).toContainText('План создан и уже открыт');
  await expect(page.getByText(/подтвердить импорт/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /утвердить импорт/i })).toHaveCount(0);
});

test('документ заседания сразу открывается как заседание без мастера согласования', async ({ page }) => {
  const documentId = 'document-grace-meeting';
  const meetingId = 'meeting-grace-ready';

  await page.route('**/api/documents', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await json(route, { documentId }, 201);
  });
  await page.route('**/api/plans?*', (route) => json(route, { items: [] }));
  await page.route('**/api/meetings?*', (route) => json(route, {
    items: [{
      id: meetingId,
      number: '7',
      title: 'Заседание кафедры',
      source_document_id: documentId,
      status: 'scheduled'
    }]
  }));

  await waitForBridge(page);
  const detail = await uploadAndWait(page, documentId);

  expect(detail).toMatchObject({ documentId, kind: 'meeting', objectId: meetingId });
  await expect(page.locator('[data-view-panel="meetings"]')).toHaveClass(/active/);
  await expect(page.locator('#intake-object-notice')).toContainText('Заседание создано и уже открыто');
  await expect(page.getByText(/ожидает подтверждения/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /подтвердить/i })).toHaveCount(0);
});

test('неопознанный документ остаётся сохранённым и не блокирует интерфейс', async ({ page }) => {
  const documentId = 'document-grace-generic';

  await page.route('**/api/plans?*', (route) => json(route, { items: [] }));
  await page.route('**/api/meetings?*', (route) => json(route, { items: [] }));

  await waitForBridge(page);
  await page.evaluate((id) => {
    window.kafedraResolveIntakeDocument(id);
  }, documentId);

  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('[data-view-panel].active')).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: /подтверж/i })).toHaveCount(0);
});
