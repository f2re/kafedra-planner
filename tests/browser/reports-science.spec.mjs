import { test, expect } from '@playwright/test';

async function upload(page, name, text) {
  await page.locator('button[data-view="documents"]:visible').first().click();
  await page.locator('#file-input').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') });
  await expect.poll(async () => {
    const response = await page.request.get('/api/documents?limit=500');
    const body = await response.json();
    return body.items?.find((item) => item.original_name === name)?.processing_status;
  }, { timeout: 30_000 }).toMatch(/processed|needs_review/);
}

test('отчёт сопоставляется, руководитель подтверждает, статья попадает в реестр', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'reports-science-desktop', 'Проверка изолированного потока отчётов и науки');
  await page.goto('/');
  await page.request.post('/api/people', { data: { displayName: 'Сидоров Сергей Сергеевич', position: 'доцент' } });

  await upload(page, 'rasporyazhenie-71.txt', `РАСПОРЯЖЕНИЕ\nот 5 августа 2026 года № 71-р\nО подготовке аналитического отчёта\nРАСПОРЯЖАЮСЬ:\n1. Подготовить аналитический отчёт по научной работе до 25 августа 2026 года. Ответственный: Сидоров Сергей Сергеевич.`);
  await expect.poll(async () => (await (await page.request.get('/api/assignments?q=аналитический')).json()).items?.length || 0).toBeGreaterThan(0);

  await upload(page, 'otchet-71.txt', `ОТЧЁТ ПО РАСПОРЯЖЕНИЮ № 71-р\nСидоров Сергей Сергеевич\nАналитический отчёт по научной работе подготовлен. Поручение выполнено.`);
  await expect.poll(async () => (await (await page.request.get('/api/report-matches?status=suggested')).json()).items?.filter((item) => item.document_title.includes('otchet-71')).length || 0, { timeout: 30_000 }).toBeGreaterThan(0);

  await page.locator('button[data-view="work"]:visible').first().click();
  const matchCard = page.locator('.report-match-card', { hasText: 'otchet-71' });
  await expect(matchCard).toBeVisible();
  await matchCard.getByRole('button', { name: 'Связать' }).click();
  await expect.poll(async () => {
    const body = await (await page.request.get('/api/assignments?q=аналитический')).json();
    return body.items?.find((item) => item.document_number === '71-р')?.status;
  }).toBe('submitted');

  const directiveCard = page.locator('.work-card', { hasText: '71-р' }).first();
  await directiveCard.click();
  const reviewForm = page.locator('.manager-review-form');
  await expect(reviewForm).toBeVisible();
  await reviewForm.getByRole('button', { name: 'Подтвердить выполнение' }).click();
  await expect.poll(async () => {
    const body = await (await page.request.get('/api/assignments?q=аналитический')).json();
    return body.items?.find((item) => item.document_number === '71-р')?.status;
  }).toBe('completed');
  await page.locator('#ux-inspector-close').click();
  await expect(page.locator('#ux-inspector')).toHaveClass(/hidden/);

  await upload(page, 'science-article.txt', `УДК 551.509\nСидоров С.С., Иванов И.И.\nЛокальные методы прогноза осадков\nАннотация. Рассмотрены методы радарного наукастинга.\nКлючевые слова: радар, прогноз.\nDOI: 10.1234/kafedra.2026.71\nЖурнал Метеорология, 2026\nПубликация входит в РИНЦ и перечень ВАК.`);
  await expect.poll(async () => (await (await page.request.get('/api/science?q=Локальные')).json()).items?.length || 0, { timeout: 30_000 }).toBeGreaterThan(0);
  await page.locator('button[data-view="science"]:visible').first().click();
  await expect(page.locator('#science-results')).toContainText('Локальные методы прогноза осадков');
  await expect(page.locator('#science-results')).toContainText('10.1234/kafedra.2026.71');

  const scienceCard = page.locator('[data-science-id]', { hasText: 'Локальные методы прогноза осадков' }).first();
  const scienceId = await scienceCard.getAttribute('data-science-id');
  expect(scienceId).toBeTruthy();
  await scienceCard.click();
  const publicationSupport = page.locator('#ux-inspector [data-supporting-open][data-target-kind="scientific_item"]');
  await expect(publicationSupport).toBeVisible({ timeout: 15_000 });

  let failSupportOnce = true;
  await page.route('**/api/supporting-documents', async (route) => {
    if (route.request().method() === 'POST' && failSupportOnce) {
      failSupportOnce = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Временная ошибка сохранения связи.' } })
      });
      return;
    }
    await route.continue();
  });

  await publicationSupport.click();
  const supportForm = page.locator('[data-supporting-form]');
  await expect(supportForm).toBeVisible();
  await supportForm.locator('[name="documentNumber"]').fill('PUB-2026-71');
  await supportForm.locator('[name="documentDate"]').fill('2026-08-20');
  await supportForm.locator('[name="title"]').fill('Подтверждение публикации');
  const evidenceName = 'publication-proof-71.pdf';
  await supportForm.locator('[name="file"]').setInputFiles({
    name: evidenceName,
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF', 'utf8')
  });
  await supportForm.locator('button[type="submit"]').click();
  await expect(supportForm.locator('[data-supporting-form-error]')).toContainText('Временная ошибка', { timeout: 15_000 });
  await expect(supportForm.locator('[name="documentNumber"]')).toHaveValue('PUB-2026-71');
  await expect(supportForm.locator('[data-supporting-upload-state]')).toContainText('Файл уже сохранён');

  const afterFailedLink = await (await page.request.get('/api/documents?limit=500')).json();
  expect((afterFailedLink.items || []).filter((item) => item.original_name === evidenceName)).toHaveLength(1);

  const supportResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/supporting-documents') && response.request().method() === 'POST'
  );
  await supportForm.locator('button[type="submit"]').click();
  expect((await supportResponse).ok()).toBeTruthy();
  await expect(page.locator('#manual-plan-modal')).toContainText('PUB-2026-71', { timeout: 15_000 });
  await expect(page.locator('#manual-plan-modal')).toContainText('Публикация');
  const afterRetry = await (await page.request.get('/api/documents?limit=500')).json();
  expect((afterRetry.items || []).filter((item) => item.original_name === evidenceName)).toHaveLength(1);

  const supportListResponse = await page.request.get(`/api/supporting-documents?targetKind=scientific_item&targetId=${encodeURIComponent(scienceId)}`);
  expect(supportListResponse.ok()).toBeTruthy();
  const supportList = await supportListResponse.json();
  const publication = (supportList.items || []).find((item) => item.document_number === 'PUB-2026-71');
  expect(publication?.document_id).toBeTruthy();
  expect(publication?.links?.some((link) => link.relation_kind === 'publication')).toBeTruthy();

  await page.locator('#manual-plan-modal > header [data-manual-close]').click();
  const sourceDocument = page.locator('#ux-inspector [data-inspector-document]');
  await expect(sourceDocument).toBeVisible();
  await sourceDocument.click();
  const documentSupport = page.locator('#document-native-preview [data-supporting-open][data-target-kind="document"]');
  await expect(documentSupport).toBeVisible({ timeout: 15_000 });
  await documentSupport.click();
  const documentSupportForm = page.locator('[data-supporting-form]');
  await documentSupportForm.locator('[name="documentNumber"]').fill('ВХ-2026-71');
  await documentSupportForm.locator('[name="documentDate"]').fill('2026-08-21');
  await documentSupportForm.locator('[name="title"]').fill('Регистрационная карточка');
  const documentSupportResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/supporting-documents') && response.request().method() === 'POST'
  );
  await documentSupportForm.locator('button[type="submit"]').click();
  expect((await documentSupportResponse).ok()).toBeTruthy();
  await expect(page.locator('#manual-plan-modal')).toContainText('ВХ-2026-71', { timeout: 15_000 });
});
