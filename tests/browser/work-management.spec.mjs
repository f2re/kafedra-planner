import { test, expect } from '@playwright/test';

async function createPerson(page, displayName) {
  const response = await page.request.post('/api/people', { data: { displayName } });
  expect(response.ok()).toBeTruthy();
  return await response.json();
}

test('распоряжение создаёт поручение, ответственность меняется inline и сохраняет историю', async ({ page }, testInfo) => {
  test.skip(!['workflow-desktop', 'workflow-mobile'].includes(testInfo.project.name), 'Рабочий поток запускается в изолированных workflow-проектах');
  const mobile = testInfo.project.name === 'workflow-mobile';
  const number = mobile ? '48-р' : '47-р';
  const uploadKey = mobile ? 'workflow-directive-mobile' : 'workflow-directive-desktop';

  const ivanov = await createPerson(page, 'Иванов Иван Иванович');
  const petrov = await createPerson(page, 'Петров Пётр Петрович');
  const sidorov = await createPerson(page, 'Сидоров Сергей Сергеевич');
  const orlov = await createPerson(page, 'Орлов Олег Олегович');

  await page.goto('/');
  await page.locator('button[data-view="documents"]:visible').first().click();
  await page.locator('#file-input').setInputFiles({
    name: `rasporyazhenie-${number}.txt`, mimeType: 'text/plain',
    buffer: Buffer.from(`РАСПОРЯЖЕНИЕ\nот 5 августа 2026 года № ${number}\nО подготовке отчёта\nРАСПОРЯЖАЮСЬ:\n1. Подготовить отчёт по НИР до 20 августа 2026 года. Ответственный: Иванов Иван Иванович.\nДиректор А.А. Смирнов`, 'utf8')
  });

  await expect.poll(async () => {
    const response = await page.request.get(`/api/directives?q=${encodeURIComponent(number)}`);
    return (await response.json()).items?.find((item) => item.document_number === number)?.id || null;
  }, { timeout: 30_000 }).not.toBeNull();

  await page.locator('button[data-view="work"]:visible').first().click();
  await expect(page.locator('[data-view-panel="work"]')).toBeVisible();
  const card = page.locator('#work-results [data-work-kind="directive"]').filter({ hasText: number }).first();
  await expect(card).toContainText('Подготовить отчёт');
  await card.click();

  const assignment = page.locator('#ux-inspector .work-assignment').first();
  await expect(assignment).toBeVisible();
  const assignmentId = await assignment.getAttribute('data-assignment-id');
  expect(assignmentId).toBeTruthy();
  await expect(assignment).toContainText('Иванов Иван Иванович');
  await assignment.locator('.work-responsibility > summary').click();

  const form = assignment.locator('[data-responsibility-form]');
  await expect(form).toBeVisible();
  await form.locator('select[name="executorPersonId"]').selectOption(petrov.id);
  await form.locator('select[name="controllerPersonId"]').selectOption(orlov.id);
  await form.locator(`input[name="coexecutorPersonIds"][value="${ivanov.id}"]`).check();
  await form.locator(`input[name="observerPersonIds"][value="${sidorov.id}"]`).check();
  await form.locator('input[name="reason"]').fill('Перераспределение нагрузки');
  await form.getByRole('button', { name: 'Сохранить ответственность' }).click();

  await expect.poll(async () => {
    const response = await page.request.get(`/api/assignments/${assignmentId}/responsibility`);
    if (!response.ok()) return null;
    const body = await response.json();
    return {
      executor: body.executor?.person_id,
      coexecutors: body.coexecutors?.map((item) => item.person_id),
      controller: body.controller?.person_id,
      observers: body.observers?.map((item) => item.person_id),
      reason: body.history?.[0]?.reason
    };
  }).toEqual({
    executor: petrov.id,
    coexecutors: [ivanov.id],
    controller: orlov.id,
    observers: [sidorov.id],
    reason: 'Перераспределение нагрузки'
  });

  const refreshed = page.locator('#ux-inspector .work-assignment').first();
  await expect(refreshed).toContainText('Петров Пётр Петрович');
  await refreshed.locator('.work-responsibility > summary').click();
  await expect(refreshed.locator('.work-history')).toContainText('Перераспределение нагрузки');
});
