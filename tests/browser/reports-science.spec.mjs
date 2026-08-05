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
  test.skip(testInfo.project.name !== 'workflow-desktop', 'Проверка изолированного рабочего потока');
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

  await upload(page, 'science-article.txt', `УДК 551.509\nСидоров С.С., Иванов И.И.\nЛокальные методы прогноза осадков\nАннотация. Рассмотрены методы радарного наукастинга.\nКлючевые слова: радар, прогноз.\nDOI: 10.1234/kafedra.2026.71\nЖурнал Метеорология, 2026\nПубликация входит в РИНЦ и перечень ВАК.`);
  await expect.poll(async () => (await (await page.request.get('/api/science?q=Локальные')).json()).items?.length || 0, { timeout: 30_000 }).toBeGreaterThan(0);
  await page.locator('button[data-view="science"]:visible').first().click();
  await expect(page.locator('#science-results')).toContainText('Локальные методы прогноза осадков');
  await expect(page.locator('#science-results')).toContainText('10.1234/kafedra.2026.71');
});
