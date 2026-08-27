import { test, expect } from '@playwright/test';

async function createPerson(page, name) {
  const response = await page.request.post('/api/people', { data: { displayName: name } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return await response.json();
}

async function createAssignedPlanItem(page, suffix) {
  const person = await createPerson(page, `Исполнитель ${suffix}`);
  const year = new Date().getFullYear();
  const planResponse = await page.request.post('/api/plans', {
    data: {
      title: `Простой план ${suffix}`,
      planKind: 'department',
      periodKind: 'calendar',
      yearStart: year,
      yearEnd: year
    }
  });
  expect(planResponse.ok(), await planResponse.text()).toBeTruthy();
  const plan = await planResponse.json();
  const itemResponse = await page.request.post(`/api/plans/${encodeURIComponent(plan.id)}/items`, {
    data: {
      title: `Подготовить материал ${suffix}`,
      direction: 'organizational',
      executionMode: 'assigned',
      executorPersonIds: [person.id],
      dueDate: `${year}-12-20`
    }
  });
  expect(itemResponse.ok(), await itemResponse.text()).toBeTruthy();
  const stored = await (await page.request.get(`/api/plans/${encodeURIComponent(plan.id)}`)).json();
  const item = stored.items.find((entry) => entry.title === `Подготовить материал ${suffix}`);
  expect(item?.assignment?.id).toBeTruthy();
  return { plan, item, person };
}

async function assignment(page, id) {
  const response = await page.request.get('/api/assignments?limit=2000');
  const body = await response.json();
  return body.items.find((item) => item.id === id);
}

test('задача завершается без согласования, материалы остаются необязательными', async ({ page }, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const created = await createAssignedPlanItem(page, suffix);
  const assignmentId = created.item.assignment.id;

  await page.goto('/');
  await page.waitForFunction(() => typeof window.kafedraOpenStandaloneAssignment === 'function', null, { timeout: 15_000 });
  await page.evaluate((id) => window.kafedraOpenStandaloneAssignment(id), assignmentId);

  const inspector = page.locator('#standalone-assignment-inspector');
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('Для завершения достаточно одного действия');
  await expect(inspector.getByRole('button', { name: 'Выполнено' })).toBeVisible();
  await expect(inspector.getByText('Подтверждающие материалы')).toBeVisible();
  await expect(inspector).not.toContainText('Подтвердить выполнение');
  await expect(inspector).not.toContainText('Вернуть на доработку');

  const completeResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/assignments/${assignmentId}/progress`
      && response.request().method() === 'POST'
  );
  await inspector.getByRole('button', { name: 'Выполнено' }).click();
  expect((await completeResponse).ok()).toBeTruthy();
  await expect(page.locator('#standalone-assignment-inspector')).toContainText('Задача выполнена');
  expect((await assignment(page, assignmentId)).status).toBe('completed');

  const planAfterCompletion = await (await page.request.get(`/api/plans/${encodeURIComponent(created.plan.id)}`)).json();
  const itemAfterCompletion = planAfterCompletion.items.find((item) => item.id === created.item.id);
  expect(itemAfterCompletion.status).toBe('completed');

  const evidenceForm = page.locator('[data-standalone-report-form]');
  await evidenceForm.locator('input[name="file"]').setInputFiles({
    name: `material-${suffix}.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from('Необязательный подтверждающий материал.', 'utf8')
  });
  const evidenceResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/assignments/${assignmentId}/report`
      && response.request().method() === 'POST'
  );
  await evidenceForm.getByRole('button', { name: 'Приложить материал' }).click();
  expect((await evidenceResponse).ok()).toBeTruthy();
  await expect(page.locator('#standalone-assignment-inspector')).toContainText('Состояние задачи не изменилось');

  const afterEvidence = await assignment(page, assignmentId);
  expect(afterEvidence.status).toBe('completed');
  expect(afterEvidence.reports).toHaveLength(1);
  expect(afterEvidence.reports[0].review_status).toBe('not_required');

  const legacyReview = await page.request.post(`/api/assignments/${encodeURIComponent(assignmentId)}/review`, {
    data: { action: 'approve' }
  });
  expect(legacyReview.status()).toBe(410);
});
