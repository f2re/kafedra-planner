import { test, expect } from '@playwright/test';

function navigationButton(page) {
  const mobile = Number(page.viewportSize()?.width || 0) <= 720;
  return mobile
    ? page.locator('.mobile-tab[data-view="meetings"]')
    : page.locator('.nav-item[data-view="meetings"]');
}

test('Заседание: дата и номер → сразу повестка без обязательных настроек выпуска', async ({ page }, testInfo) => {
  const year = testInfo.project.name.includes('mobile') ? 2042 : 2041;
  const number = testInfo.project.name.includes('mobile') ? 'R3-M' : 'R3-D';

  await page.goto('/');
  await page.waitForFunction(() => document.querySelector('[data-view="meetings"]'), null, { timeout: 12_000 });
  await navigationButton(page).click();
  await expect(page.locator('[data-view-panel="meetings"]')).toBeVisible();

  const yearInput = page.locator('#meeting-year-filter');
  await yearInput.fill(String(year));
  await yearInput.blur();

  await page.locator('#meeting-create-button').click();
  const createForm = page.locator('#meeting-create-form');
  await expect(createForm).toBeVisible();
  await expect(page.locator('#meeting-settings-form')).toHaveCount(0);
  await expect(createForm.locator('[name="title"]')).toHaveCount(0);
  await expect(createForm).toContainText('Этого достаточно');

  await createForm.locator('[name="meetingDate"]').fill(`${year}-09-15`);
  await createForm.locator('[name="protocolNumber"]').fill(number);
  await createForm.getByRole('button', { name: 'Создать' }).click();

  await expect(page.locator('#meeting-modal')).toBeHidden();
  await expect(page.locator('#meeting-detail')).toContainText(`Протокол №${number}`);
  await expect(page.locator('#meeting-detail')).toContainText('Повестка');
  await expect(page.locator('#meeting-detail')).toContainText('Кворум —');

  await page.locator('[data-add-manual-question]').click();
  const agendaForm = page.locator('#agenda-item-form');
  await expect(agendaForm).toBeVisible();
  await agendaForm.locator('[name="title"]').fill('Об утверждении плана работы кафедры');
  await agendaForm.getByRole('button', { name: 'Сохранить' }).click();

  await expect(page.locator('#meeting-modal')).toBeHidden();
  await expect(page.locator('#meeting-detail')).toContainText('Об утверждении плана работы кафедры');
  await expect(page.locator('[data-agenda-item]')).toHaveCount(1);
});
