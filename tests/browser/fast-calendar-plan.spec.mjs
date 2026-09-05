import { test, expect } from '@playwright/test';

async function archiveManualPlans(page) {
  const response = await page.request.get('/api/plans?limit=500');
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  for (const plan of payload.items || []) {
    if (plan.origin_kind !== 'manual' || plan.status !== 'active') continue;
    const archived = await page.request.post(`/api/plans/${encodeURIComponent(plan.id)}/archive`, {
      data: { replacementPlanId: null, reason: 'R7 browser isolation' }
    });
    expect(archived.ok()).toBeTruthy();
  }
}

async function createManualPlan(page, title, year = 2026) {
  const response = await page.request.post('/api/plans', {
    data: {
      title,
      planKind: 'department',
      periodKind: 'calendar',
      yearStart: year,
      yearEnd: year,
      ownerPersonId: null
    }
  });
  expect(response.ok()).toBeTruthy();
  return await response.json();
}

async function openCalendar(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.kafedraSetView === 'function' && typeof window.kafedraOpenFastCalendarEntry === 'function');
  await expect(page.locator('[data-view-panel="calendar"]')).toBeVisible();
}

async function chooseVisibleCalendarDate(page) {
  const cell = page.locator('[data-calendar-date]:visible').nth(8);
  await expect(cell).toBeVisible();
  const date = await cell.getAttribute('data-calendar-date');
  expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  await cell.click({ position: { x: 8, y: 30 } });
  return date;
}

test('клик + в дне сразу открывает короткую календарную форму и сохраняет раскрытые поля', async ({ page }) => {
  await openCalendar(page);
  const add = page.locator('[data-new-on-date]:visible').nth(8);
  const date = await add.getAttribute('data-new-on-date');
  await add.click();

  await expect(page.locator('#event-sheet')).toBeVisible();
  await expect(page.locator('#action-center')).toBeHidden();
  await expect(page.locator('#event-title')).toBeFocused();
  await expect(page.locator('#event-date')).toHaveValue(date);
  await expect(page.locator('#event-date')).toHaveAttribute('data-ui-preference-origin', 'domain');
  const details = page.locator('#event-more-fields');
  await expect(details).not.toHaveAttribute('open', '');

  await page.locator('#event-title').fill('Короткая запись R7');
  await details.locator('summary').click();
  await page.locator('#event-category').selectOption('science');
  await page.locator('#event-importance').selectOption('high');
  await page.locator('#event-reminder').selectOption('1440');
  await page.locator('#event-description').fill('Редкие поля сохранены из раскрытия');

  const write = page.waitForRequest((request) => request.url().endsWith('/api/calendar') && request.method() === 'POST');
  await page.locator('#event-form button[type="submit"]').click();
  const request = await write;
  const body = request.postDataJSON();
  expect(body).toMatchObject({
    title: 'Короткая запись R7',
    date,
    category: 'science',
    importance: 'high',
    reminderMinutes: 1440,
    description: 'Редкие поля сохранены из раскрытия'
  });
});

test('0 планов: создание плана автоматически продолжает исходное действие календаря', async ({ page }, testInfo) => {
  await archiveManualPlans(page);
  await openCalendar(page);
  const date = await chooseVisibleCalendarDate(page);
  await page.locator('[data-manual-calendar-add]').click();

  const create = page.locator('#manual-plan-create-form');
  await expect(create).toBeVisible();
  await expect(create).toContainText('После создания плана сразу откроется исходное действие из календаря');
  await create.locator('[name="title"]').fill(`R7 zero ${testInfo.project.name}`);
  await create.locator('[name="yearStart"]').fill(date.slice(0, 4));
  await create.locator('button[type="submit"]').click();

  const item = page.locator('#manual-plan-item-form');
  await expect(item).toBeVisible({ timeout: 15_000 });
  await expect(item.locator('[name="startsAt"]')).toHaveValue(date);
  await expect(item.locator('[name="startsAt"]')).toHaveAttribute('data-ui-preference-origin', 'domain');
  await expect(page.locator('[data-manual-calendar-plan-next]')).toHaveCount(0);
});

test('1 план: В план сразу открывает форму пункта без промежуточного Продолжить', async ({ page }, testInfo) => {
  await archiveManualPlans(page);
  await createManualPlan(page, `R7 single ${testInfo.project.name}`);
  await openCalendar(page);
  const date = await chooseVisibleCalendarDate(page);
  await page.locator('[data-manual-calendar-add]').click();

  const item = page.locator('#manual-plan-item-form');
  await expect(item).toBeVisible({ timeout: 10_000 });
  await expect(item.locator('[name="startsAt"]')).toHaveValue(date);
  await expect(item.locator('select[name="planId"]')).toHaveCount(0);
  await expect(page.locator('#manual-calendar-plan-select')).toHaveCount(0);
  await expect(page.locator('#manual-plan-more-fields')).toBeVisible();
});

test('несколько планов: выбор плана находится в той же форме и определяет штатный POST пункта', async ({ page }, testInfo) => {
  await archiveManualPlans(page);
  const first = await createManualPlan(page, `R7 first ${testInfo.project.name}`);
  const second = await createManualPlan(page, `R7 second ${testInfo.project.name}`);
  await openCalendar(page);
  const date = await chooseVisibleCalendarDate(page);
  await page.locator('[data-manual-calendar-add]').click();

  const form = page.locator('#manual-plan-item-form');
  await expect(form).toBeVisible({ timeout: 10_000 });
  const plan = form.locator('select[name="planId"]');
  await expect(plan).toBeVisible();
  await expect(plan.locator('option')).toHaveCount(2);
  await plan.selectOption(second.id);
  await form.locator('[name="title"]').fill(`R7 item ${testInfo.project.name}`);
  await form.locator('[name="startsAt"]').fill(date);
  const more = page.locator('#manual-plan-more-fields');
  await more.locator('summary').click();
  await form.locator('[name="expectedResult"]').fill('Проверенный результат');

  const write = page.waitForRequest((request) =>
    new URL(request.url()).pathname === `/api/plans/${second.id}/items` && request.method() === 'POST'
  );
  await form.locator('button[type="submit"]').click();
  const request = await write;
  expect(request.postDataJSON().expectedResult).toBe('Проверенный результат');
  expect(first.id).not.toBe(second.id);
});
