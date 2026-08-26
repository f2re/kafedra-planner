import { test, expect } from '@playwright/test';

async function createPerson(page, displayName) {
  const response = await page.request.post('/api/people', { data: { displayName } });
  expect(response.ok()).toBeTruthy();
  return await response.json();
}

function viewButton(page, view, mobile) {
  return mobile
    ? page.locator(`.mobile-tab[data-view="${view}"]`).first()
    : page.locator(`.nav-item[data-view="${view}"]`).first();
}

test('распоряжение создаёт поручение, ответственность меняется inline и сохраняет историю', async ({ page }, testInfo) => {
  test.skip(!['workflow-desktop', 'workflow-mobile'].includes(testInfo.project.name), 'Рабочий поток запускается в изолированных workflow-проектах');
  const mobile = testInfo.project.name === 'workflow-mobile';
  const number = mobile ? '48-р' : '47-р';

  const ivanov = await createPerson(page, 'Иванов Иван Иванович');
  const petrov = await createPerson(page, 'Петров Пётр Петрович');
  const sidorov = await createPerson(page, 'Сидоров Сергей Сергеевич');
  const orlov = await createPerson(page, 'Орлов Олег Олегович');

  await page.goto('/');
  await viewButton(page, 'documents', mobile).click();
  await page.locator('#file-input').setInputFiles({
    name: `rasporyazhenie-${number}.txt`, mimeType: 'text/plain',
    buffer: Buffer.from(`РАСПОРЯЖЕНИЕ\nот 5 августа 2026 года № ${number}\nО подготовке отчёта\nРАСПОРЯЖАЮСЬ:\n1. Подготовить отчёт по НИР до 20 августа 2026 года. Ответственный: Иванов Иван Иванович.\nДиректор А.А. Смирнов`, 'utf8')
  });

  await expect.poll(async () => {
    const response = await page.request.get(`/api/directives?q=${encodeURIComponent(number)}`);
    return (await response.json()).items?.find((item) => item.document_number === number)?.id || null;
  }, { timeout: 30_000 }).not.toBeNull();

  await viewButton(page, 'work', mobile).click();
  await expect(page.locator('[data-view-panel="work"]')).toBeVisible();
  const card = page.locator('#work-results [data-work-kind="directive"]').filter({ hasText: number }).first();
  await expect(card).toBeVisible();
  await card.click();

  const assignment = page.locator('#ux-inspector .work-assignment').first();
  await expect(assignment).toBeVisible();
  await expect(assignment).toContainText('Подготовить отчёт');
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

test('периодическая задача разделяет плановый рубеж и контрольный срок, перенос виден в истории', async ({ page }, testInfo) => {
  test.skip(!['workflow-desktop', 'workflow-mobile'].includes(testInfo.project.name), 'Рабочий поток запускается в изолированных workflow-проектах');
  const mobile = testInfo.project.name === 'workflow-mobile';
  const suffix = mobile ? 'моб' : 'деск';
  const owner = await createPerson(page, `Сотрудник Периодический ${suffix}`);
  const manager = await createPerson(page, `Руководитель Периодический ${suffix}`);

  await page.goto('/');
  await viewButton(page, 'work', mobile).click();
  const form = page.locator('#periodic-task-form');
  const launcher = page.locator('#work-create-periodic');
  await expect(launcher).toBeVisible();
  await expect(launcher).toHaveAttribute('aria-expanded', 'false');
  await expect(form).not.toBeVisible();
  await launcher.click();
  await expect(launcher).toHaveAttribute('aria-expanded', 'true');
  await expect(form).toBeVisible();
  await form.locator('input[name="title"]').fill(`Контрольная задача ${suffix}`);
  await form.locator('select[name="ownerPersonId"]').selectOption(owner.id);
  await form.locator('select[name="managerPersonId"]').selectOption(manager.id);
  await form.locator('select[name="periodKind"]').selectOption('semester');
  await form.locator('input[name="periodKey"]').fill('2026-1');
  await form.locator('input[name="startsAt"]').fill('2026-08-12');
  await form.locator('input[name="dueDate"]').fill('2026-08-25');
  await form.locator('select[name="direction"]').selectOption('science');
  await form.locator('textarea[name="expectedResult"]').fill('Проверенный отчёт');
  await form.getByRole('button', { name: 'Создать задачу' }).click();

  const periodicCard = page.locator('#work-results [data-work-kind="periodic_task"]').filter({ hasText: `Контрольная задача ${suffix}` }).first();
  await expect(periodicCard).toBeVisible();
  await expect(periodicCard).toContainText('2026-08-25');
  const periodicId = await periodicCard.getAttribute('data-work-id');
  expect(periodicId).toBeTruthy();
  await periodicCard.click();

  const inspector = page.locator('#ux-inspector-body');
  await expect(inspector).toContainText('Плановый рубеж: 2026-08-12');
  await expect(inspector).toContainText('Контрольный срок: 2026-08-25');
  const edit = inspector.locator('[data-periodic-edit-form]');
  await expect(edit).toBeVisible();
  await edit.locator('input[name="startsAt"]').fill('2026-08-15');
  await edit.locator('input[name="dueDate"]').fill('2026-08-30');
  await edit.locator('input[name="reason"]').fill('Срок уточнён руководителем');
  await edit.getByRole('button', { name: 'Сохранить изменения' }).click();

  await expect.poll(async () => {
    const response = await page.request.get(`/api/periodic-tasks/${periodicId}`);
    if (!response.ok()) return null;
    const body = await response.json();
    return { planned: body.starts_at, due: body.due_date, reason: body.history?.[0]?.reason };
  }).toEqual({ planned: '2026-08-15', due: '2026-08-30', reason: 'Срок уточнён руководителем' });

  await expect(page.locator('#ux-inspector-body')).toContainText('Срок уточнён руководителем');
  const calendar = await page.request.get('/api/calendar?from=2026-08-01&to=2026-09-05&limit=2000');
  expect(calendar.ok()).toBeTruthy();
  const calendarItems = (await calendar.json()).items.filter((item) => item.source_id === periodicId);
  expect(calendarItems.find((item) => item.source_kind === 'periodic_task')?.starts_at).toBe('2026-08-30');
  expect(calendarItems.find((item) => item.source_kind === 'periodic_task_plan')?.starts_at).toBe('2026-08-15');
  expect(calendarItems.find((item) => item.source_kind === 'periodic_task_plan')?.reminder_minutes).toBeNull();
});
