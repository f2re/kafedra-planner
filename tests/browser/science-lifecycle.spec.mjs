import { test, expect } from '@playwright/test';

function navigationButton(page, view) {
  const mobile = Number(page.viewportSize()?.width || 0) <= 720;
  return mobile
    ? page.locator(`.mobile-tab[data-view="${view}"]`)
    : page.locator(`.nav-item[data-view="${view}"]`);
}

async function createScience(page, suffix) {
  await page.goto('/');
  const response = await page.request.post('/api/science', {
    data: {
      title: `Радарный прогноз осадков ${suffix}`,
      kind: 'article',
      authors: ['Иванов Иван Иванович'],
      classifications: ['ВАК', 'РИНЦ']
    }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createManualPlan(page, suffix) {
  const response = await page.request.post('/api/plans', {
    data: {
      title: `Научный план ${suffix}`,
      planKind: 'department',
      periodKind: 'calendar',
      yearStart: 2026
    }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test.beforeEach(async ({ page }, testInfo) => {
  page.on('pageerror', (error) => console.log(`[science-lifecycle:${testInfo.project.name}:pageerror] ${error.stack || error.message}`));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      console.log(`[science-lifecycle:${testInfo.project.name}:${message.type()}] ${message.text()}`);
    }
  });
});

test('Наука: редактор → этапы → мероприятие в плане', async ({ page }, testInfo) => {
  const suffix = testInfo.project.name;
  const science = await createScience(page, suffix);
  const plan = await createManualPlan(page, suffix);

  await navigationButton(page, 'science').click();
  const card = page.locator(`[data-science-id="${science.id}"]`);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click();
  await expect(page.locator('#science-lifecycle-panel')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#science-lifecycle-panel')).toContainText('Замысел');

  await page.locator('[data-science-editor]').click();
  const editor = page.locator('[data-science-editor-form]');
  await expect(editor).toBeVisible();
  await editor.locator('[name="title"]').fill(`Исправленный радарный прогноз ${suffix}`);
  await editor.locator('[name="publicationYear"]').fill('2026');
  await editor.locator('[name="classifications"]').fill('ВАК, РИНЦ');
  await editor.locator('[name="nextAction"]').fill('Подать рукопись в редакцию');
  await editor.locator('[name="nextActionDue"]').fill('2026-09-15');
  await editor.locator('[name="reason"]').fill('Уточнено по авторскому экземпляру');
  const editorResponse = page.waitForResponse(
    (response) => response.url().endsWith(`/api/science/${science.id}/editor`) && response.request().method() === 'PATCH'
  );
  await editor.locator('button[type="submit"]').click();
  expect((await editorResponse).ok()).toBeTruthy();
  await expect(page.locator('#science-lifecycle-panel')).toContainText('Подать рукопись в редакцию', { timeout: 15_000 });

  await page.locator('[data-science-transition]').click();
  const transition = page.locator('[data-science-transition-form]');
  await transition.locator('[name="status"]').selectOption('published');
  await transition.locator('[name="eventDate"]').fill('2026-08-20');
  await transition.locator('[name="note"]').fill('Недопустимый прямой переход должен сохранить форму');
  const invalidResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith(`/api/science/${science.id}/lifecycle-events`) && response.request().method() === 'POST'
  );
  await transition.locator('button[type="submit"]').click();
  expect((await invalidResponsePromise).status()).toBe(409);
  await expect(transition.locator('[data-science-lifecycle-error]')).toContainText('переход', { timeout: 15_000 });
  await expect(transition.locator('[name="note"]')).toHaveValue('Недопустимый прямой переход должен сохранить форму');
  await page.locator('#science-lifecycle-modal .secondary-button[data-science-lifecycle-close]').click();

  for (const [status, eventDate] of [['drafting','2026-08-20'], ['submitted','2026-09-16'], ['accepted','2026-10-01']]) {
    await page.locator('[data-science-transition]').click();
    const form = page.locator('[data-science-transition-form]');
    await form.locator('[name="status"]').selectOption(status);
    await form.locator('[name="eventDate"]').fill(eventDate);
    await form.locator('[name="note"]').fill(`Этап ${status}`);
    const response = page.waitForResponse(
      (item) => item.url().endsWith(`/api/science/${science.id}/lifecycle-events`) && item.request().method() === 'POST'
    );
    await form.locator('button[type="submit"]').click();
    expect((await response).ok()).toBeTruthy();
    await expect(page.locator('#science-lifecycle-panel')).toContainText(status === 'drafting' ? 'Готовится' : status === 'submitted' ? 'Подано' : 'Принято', { timeout: 15_000 });
  }

  await page.locator('[data-science-link-plan]').click();
  const planForm = page.locator('[data-science-plan-form]');
  await expect(planForm).toBeVisible();
  await planForm.locator('[name="planId"]').selectOption(plan.id);
  await planForm.locator('[name="title"]').fill(`Подготовить публикацию ${suffix}`);
  await planForm.locator('[name="dueDate"]').fill('2026-11-01');
  await planForm.locator('[name="executionMode"]').selectOption('track');
  const planResponse = page.waitForResponse(
    (response) => response.url().endsWith(`/api/science/${science.id}/plan-link`) && response.request().method() === 'POST'
  );
  await planForm.locator('button[type="submit"]').click();
  expect((await planResponse).ok()).toBeTruthy();
  await expect(page.locator('#science-lifecycle-panel')).toContainText(`Научный план ${suffix}`, { timeout: 15_000 });

  const planPayload = await (await page.request.get(`/api/plans/${plan.id}`)).json();
  expect(planPayload.items.some((item) => item.title === `Подготовить публикацию ${suffix}`)).toBeTruthy();
  const lifecycle = await (await page.request.get(`/api/science/${science.id}/lifecycle`)).json();
  expect(lifecycle.manual_override.reason).toBe('Уточнено по авторскому экземпляру');
  expect(lifecycle.revisions.length).toBeGreaterThan(0);
  expect(lifecycle.lifecycle_events.length).toBe(3);
});
