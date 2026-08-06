import { test, expect } from '@playwright/test';

async function upload(page, name, text) {
  await page.locator('button[data-view="documents"]:visible').first().click();
  await page.locator('#file-input').setInputFiles({
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from(text, 'utf8')
  });
  await expect.poll(async () => {
    const response = await page.request.get('/api/documents?limit=500');
    const body = await response.json();
    return body.items?.find((item) => item.original_name === name)?.processing_status;
  }, { timeout: 30_000 }).toMatch(/processed|needs_review/);
}

test('оператор исправляет показатель, сохраняет вид и экспортирует выборку', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'plan-fact-desktop', 'Изолированный контур инструментов план/факт');
  await page.goto('/');

  const manager = await (await page.request.post('/api/people', {
    data: { displayName: 'Морозов Михаил Михайлович', position: 'заведующий кафедрой' }
  })).json();
  const owner = await (await page.request.post('/api/people', {
    data: {
      displayName: 'Волкова Валерия Викторовна',
      position: 'доцент',
      managerId: manager.id
    }
  })).json();

  await upload(page, 'rasporyazhenie-tools-91.txt', `РАСПОРЯЖЕНИЕ
от 5 августа 2026 года № 91-р
О публикационной активности
РАСПОРЯЖАЮСЬ:
1. Подготовить не менее 5 статей ВАК и представить отчёт до 20 августа 2026 года. Ответственный: Волкова Валерия Викторовна.`);

  await upload(page, 'otchet-tools-91.txt', `ОТЧЁТ ПО РАСПОРЯЖЕНИЮ № 91-р
Волкова Валерия Викторовна
Показатель: статьи ВАК; план: 5; факт: 4
Поручение выполнено частично.`);

  await expect.poll(async () => {
    const body = await (await page.request.get('/api/report-matches?status=suggested&limit=100')).json();
    return body.items?.find((item) => item.document_number === '91-р') || null;
  }, { timeout: 30_000 }).not.toBeNull();

  const matches = await (await page.request.get('/api/report-matches?status=suggested&limit=100')).json();
  const reportMatch = matches.items.find((item) => item.document_number === '91-р');
  await page.request.post(`/api/report-matches/${encodeURIComponent(reportMatch.id)}/accept`, {
    data: { personId: owner.id }
  });

  const assignments = await (await page.request.get('/api/assignments?q=статей ВАК')).json();
  const assignment = assignments.items.find((item) => item.document_number === '91-р');
  await page.request.post(`/api/assignments/${encodeURIComponent(assignment.id)}/review`, {
    data: { action: 'approve', personId: manager.id, note: 'Проверено.' }
  });

  await page.locator('button[data-view="plan-fact"]:visible').first().click();
  await expect(page.locator('#plan-fact-tools-bar')).toBeVisible();
  await expect(page.locator(`#current-person-select option[value="${owner.id}"]`)).toHaveText('Волкова Валерия Викторовна');
  await page.locator('#current-person-select').selectOption(owner.id);

  const card = page.locator(`[data-plan-fact-id="${assignment.id}"]`);
  await expect(card).toBeVisible();
  await card.click();
  const factButton = page.locator('[data-pft-correct][data-field-kind="actual_numeric"]');
  await expect(factButton).toBeVisible();
  await factButton.click();

  const correctionForm = page.locator('#metric-correction-form');
  await expect(correctionForm).toBeVisible();
  await correctionForm.locator('input[name="value"]').fill('5');
  await correctionForm.locator('textarea[name="reason"]').fill('Исправлено по приложению к отчёту');
  await correctionForm.locator('select[name="actorPersonId"]').selectOption(manager.id);
  await correctionForm.locator('button[type="submit"]').click();

  await expect(page.locator('#ux-inspector-body')).toContainText('100%');
  await expect(page.locator('#ux-inspector-body')).toContainText('машинное: 4');
  await expect(page.locator('#plan-fact-correction-history')).toContainText('Исправлено по приложению к отчёту');

  await page.locator('#plan-fact-view-save').click();
  const viewForm = page.locator('#plan-fact-view-form');
  await viewForm.locator('input[name="name"]').fill('Мои публикации');
  await viewForm.locator('button[type="submit"]').click();
  await expect(page.locator('#plan-fact-view-select option')).toContainText(['Текущие фильтры', 'Мои публикации']);

  const csvResponse = await page.request.get(`/api/plan-fact/export.csv?ownerPersonId=${encodeURIComponent(owner.id)}`);
  expect(csvResponse.status()).toBe(200);
  expect(csvResponse.headers()['content-disposition']).toContain('plan-fakt.csv');
  const csv = await csvResponse.text();
  expect(csv).toContain('Исправлено вручную');
  expect(csv).toContain('Исправлено по приложению к отчёту');

  const jsonResponse = await page.request.get(`/api/plan-fact/export.json?ownerPersonId=${encodeURIComponent(owner.id)}`);
  const exported = await jsonResponse.json();
  expect(exported.items[0].metrics[0].actualNumeric).toBe(5);
  expect(exported.items[0].metrics[0].machineActualNumeric).toBe(4);

  await page.locator('[data-pft-revert]').click();
  await expect(page.locator('#ux-inspector-body')).toContainText('80%');
  await expect(page.locator('#plan-fact-correction-history')).toContainText('отменено');
});
