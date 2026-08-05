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

test('показывает персональный план-факт из подтверждённого отчёта', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'reports-science-desktop', 'Изолированный контур план/факт');
  await page.goto('/');

  const managerResponse = await page.request.post('/api/people', {
    data: { displayName: 'Кузнецов Константин Константинович', position: 'заведующий кафедрой' }
  });
  const manager = await managerResponse.json();
  const ownerResponse = await page.request.post('/api/people', {
    data: {
      displayName: 'Орлова Ольга Олеговна',
      position: 'доцент',
      managerId: manager.id
    }
  });
  const owner = await ownerResponse.json();

  await upload(page, 'rasporyazhenie-82.txt', `РАСПОРЯЖЕНИЕ\nот 5 августа 2026 года № 82-р\nО публикационной активности\nРАСПОРЯЖАЮСЬ:\n1. Подготовить не менее 5 статей ВАК и представить отчёт до 20 августа 2026 года. Ответственный: Орлова Ольга Олеговна.`);
  await expect.poll(async () => {
    const body = await (await page.request.get('/api/assignments?q=статей ВАК')).json();
    return body.items?.length || 0;
  }, { timeout: 30_000 }).toBeGreaterThan(0);

  await upload(page, 'otchet-plan-fact-82.txt', `ОТЧЁТ ПО РАСПОРЯЖЕНИЮ № 82-р\nОрлова Ольга Олеговна\nПоказатель: статьи ВАК; план: 5; факт: 4\nПоручение выполнено частично.`);
  const match = await expect.poll(async () => {
    const body = await (await page.request.get('/api/report-matches?status=suggested&limit=100')).json();
    return body.items?.find((item) => item.document_number === '82-р') || null;
  }, { timeout: 30_000 }).not.toBeNull();

  const matches = await (await page.request.get('/api/report-matches?status=suggested&limit=100')).json();
  const reportMatch = matches.items.find((item) => item.document_number === '82-р');
  await page.request.post(`/api/report-matches/${encodeURIComponent(reportMatch.id)}/accept`, {
    data: { personId: owner.id }
  });

  const managerNotifications = await (await page.request.get(`/api/personal-notifications?personId=${encodeURIComponent(manager.id)}&limit=100`)).json();
  expect(managerNotifications.items.some((item) => item.kind === 'manager_review')).toBeTruthy();

  const assignments = await (await page.request.get('/api/assignments?q=статей ВАК')).json();
  const assignment = assignments.items.find((item) => item.document_number === '82-р');
  await page.request.post(`/api/assignments/${encodeURIComponent(assignment.id)}/review`, {
    data: { action: 'approve', personId: manager.id, note: 'Фактический результат подтверждён.' }
  });

  const planFact = await (await page.request.get(`/api/assignments/${encodeURIComponent(assignment.id)}/plan-fact`)).json();
  expect(planFact.status).toBe('completed');
  expect(planFact.progressPercent).toBe(80);
  expect(planFact.metrics[0].targetNumeric).toBe(5);
  expect(planFact.metrics[0].actualNumeric).toBe(4);
  expect(planFact.metrics[0].attainmentPercent).toBe(80);

  await page.locator('button[data-view="plan-fact"]:visible').first().click();
  await expect(page.locator('#plan-fact-summary')).toBeVisible();
  await expect(page.locator('#plan-fact-results')).toContainText('80%');
  await expect(page.locator('#plan-fact-results')).toContainText('Орлова Ольга Олеговна');

  await page.locator('#current-person-select').selectOption(owner.id);
  await expect.poll(async () => {
    const response = await page.request.get(`/api/plan-fact?ownerPersonId=${encodeURIComponent(owner.id)}`);
    const body = await response.json();
    return body.items?.find((item) => item.id === assignment.id)?.progressPercent;
  }).toBe(80);

  const card = page.locator(`[data-plan-fact-id="${assignment.id}"]`);
  await card.click();
  await expect(page.locator('#ux-inspector-body')).toContainText('Показатели');
  await expect(page.locator('#ux-inspector-body')).toContainText('5');
  await expect(page.locator('#ux-inspector-body')).toContainText('4');
  await expect(page.locator('#ux-inspector-body')).toContainText('80%');
});
