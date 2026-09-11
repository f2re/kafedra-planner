import { test, expect } from '@playwright/test';

async function create(page, number, date) {
  const response = await page.request.post('/api/meetings', { data: { protocolNumber: number, meetingDate: date } });
  expect(response.status()).toBe(201);
  return response.json();
}
async function readMeeting(page, id) {
  const response = await page.request.get(`/api/meetings/${id}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function openMeeting(page, id) {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.kafedraOpenMeeting === 'function');
  await page.evaluate((meetingId) => window.kafedraOpenMeeting(meetingId), id);
  await expect(page.locator('[data-view-panel="meetings"]')).toBeVisible();
}

test('Заседания: перенос с потерянным ответом → другой год → исправление даты → перезагрузка', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile';
  const year = mobile ? 2044 : 2041;
  const a = await create(page, `transfer-source-${testInfo.project.name}`, `${year}-09-15`);
  const b = await create(page, `transfer-target-${testInfo.project.name}`, `${year + 1}-01-20`);
  let response = await page.request.post(`/api/meetings/${a.id}/agenda`, { data: {
    title: 'Вопрос для переноса', heardText: 'Доклад сотрудника', discussedText: 'Обсуждение итогов',
    decisionText: 'Утвердить итоги', responsibleRaw: 'Петров П.П.', dueDate: `${year + 1}-02-01`
  } });
  expect(response.ok()).toBeTruthy();
  const item = (await response.json()).agenda[0];
  response = await page.request.post(`/api/meetings/${b.id}/agenda`, { data: { title: 'Первый вопрос' } });
  expect(response.ok()).toBeTruthy();
  await openMeeting(page, a.id);
  await expect(page.locator(`[data-agenda-item="${item.id}"]`)).toBeVisible();
  await page.locator(`[data-agenda-item="${item.id}"] [data-agenda-transfer]`).click();
  const form = page.locator('#meeting-transfer-form');
  await expect(form).toBeVisible();
  await form.locator('[name="query"]').fill(String(year + 1));
  await expect(form.locator(`[name="targetMeetingId"] option[value="${b.id}"]`)).toHaveCount(1);
  await form.locator('[name="targetMeetingId"]').selectOption(b.id);
  await page.screenshot({ path: testInfo.outputPath('transfer-dialog.png'), fullPage: true });
  let failOnce = true;
  let attempts = 0;
  const transferPath = `**/api/meetings/${a.id}/agenda/${item.id}/transfer`;
  await page.route(transferPath, async (route) => {
    attempts += 1;
    if (failOnce) {
      failOnce = false;
      const committed = await route.fetch();
      expect(committed.ok()).toBeTruthy();
      await route.abort('failed');
    } else await route.continue();
  });
  await form.locator('[type="submit"]').click();
  await expect(form.locator('[data-transfer-error]')).toBeVisible();
  await expect(form.locator('[name="targetMeetingId"]')).toHaveValue(b.id);
  await expect(form.locator('[name="query"]')).toHaveValue(String(year + 1));
  expect((await readMeeting(page, b.id)).agenda).toHaveLength(2);
  await form.locator('[type="submit"]').click();
  await expect(page.locator('#meeting-modal')).toBeHidden();
  await expect(page.locator('#meeting-detail')).toContainText(b.protocol_number);
  await expect(page.locator('#meeting-year-filter')).toHaveValue(String(year + 1));
  expect(attempts).toBe(2);
  const moved = (await readMeeting(page, b.id)).agenda[1];
  expect(moved.id).toBe(item.id);
  expect(moved.decision.id).toBe(item.decision.id);
  expect(moved.decision.due_date).toBe(`${year + 1}-02-01`);
  expect((await readMeeting(page, a.id)).agenda).toHaveLength(0);
  await page.locator('[data-edit-meeting]').click();
  await page.locator('#meeting-edit-form [name="meetingDate"]').fill(`${year + 2}-03-17`);
  await page.locator('#meeting-edit-form [type="submit"]').click();
  await expect(page.locator('#meeting-modal')).toBeHidden();
  await expect(page.locator('#meeting-year-filter')).toHaveValue(String(year + 2));
  await page.reload();
  await page.waitForFunction(() => typeof window.kafedraOpenMeeting === 'function');
  const nav = mobile ? '.mobile-tab[data-view="meetings"]' : '.nav-item[data-view="meetings"]';
  await page.locator(nav).click();
  await expect(page.locator('#meeting-year-filter')).toHaveValue(String(year + 2));
  await expect(page.locator(`[data-meeting-id="${b.id}"]`)).toBeVisible();
  await expect(page.locator(`[data-agenda-item="${item.id}"]`)).toBeVisible();
  const saved = await readMeeting(page, b.id);
  expect(saved.meeting_date).toBe(`${year + 2}-03-17`);
  expect(saved.agenda[1].decision.due_date).toBe(`${year + 1}-02-01`);
  const width = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }));
  expect(width.page).toBeLessThanOrEqual(width.viewport + 1);
  await page.screenshot({ path: testInfo.outputPath('meeting-after-transfer.png'), fullPage: true });
});

test('Заседания: создание сразу выбирает год введённой даты', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.kafedraOpenMeeting === 'function');
  const mobile = testInfo.project.name === 'mobile';
  await page.locator(mobile ? '.mobile-tab[data-view="meetings"]' : '.nav-item[data-view="meetings"]').click();
  await page.locator('#meeting-create-button').click();
  const form = page.locator('#meeting-create-form');
  const number = `created-${testInfo.project.name}`;
  await form.locator('[name="meetingDate"]').fill('2048-05-12');
  await form.locator('[name="protocolNumber"]').fill(number);
  await form.locator('[type="submit"]').click();
  await expect(page.locator('#meeting-modal')).toBeHidden();
  await expect(page.locator('#meeting-year-filter')).toHaveValue('2048');
  await expect(page.locator('#meeting-detail')).toContainText(number);
});
