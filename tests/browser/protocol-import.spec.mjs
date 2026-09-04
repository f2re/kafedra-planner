import { test, expect } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function navigationButton(page) {
  const mobile = Number(page.viewportSize()?.width || 0) <= 720;
  return mobile
    ? page.locator('.mobile-tab[data-view="meetings"]')
    : page.locator('.nav-item[data-view="meetings"]');
}

function protocolText(year, number, withResponsible = false) {
  return `ПРОТОКОЛ ЗАСЕДАНИЯ КАФЕДРЫ${number ? ` № ${number}` : ''}
от ${withResponsible ? '6' : '5'} сентября ${year} года

ПОВЕСТКА ДНЯ
1. ${withResponsible ? 'О подготовке годового отчёта' : 'Об итогах учебного года'}.
СЛУШАЛИ: Доклад заведующего кафедрой.
РЕШИЛИ: ${withResponsible
    ? `Подготовить отчёт до 20 октября ${year} года. Ответственный: Сидоров П.П.`
    : 'Принять информацию к сведению.'}`;
}

async function annualSummary(page, year) {
  const response = await page.request.get(`/api/protocol-imports?year=${year}`);
  if (!response.ok()) return null;
  return (await response.json()).summary;
}

test('Протоколы за год: пакетная загрузка → исключения → исправление → готово', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const year = testInfo.project.name === 'mobile' ? 2032 : 2031;
  const dir = await mkdtemp(join(tmpdir(), `kafedra-protocol-import-${testInfo.project.name}-`));
  const readyPath = join(dir, `Протокол ${year} готов.txt`);
  const reviewPath = join(dir, `Протокол ${year} проверить.txt`);
  try {
    await writeFile(readyPath, protocolText(year, '1'));
    await writeFile(reviewPath, protocolText(year, null, true));

    await page.goto('/');
    await page.waitForFunction(() => document.querySelector('[data-view="meetings"]'), null, { timeout: 12_000 });
    await navigationButton(page).click();
    await expect(page.locator('[data-view-panel="meetings"]')).toBeVisible();

    const yearInput = page.locator('#meeting-year-filter');
    await yearInput.fill(String(year));
    await yearInput.blur();
    await expect(page.locator('#protocol-import-summary')).toContainText(`${year} год`);

    const upload = page.locator('#protocol-import-input');
    await upload.setInputFiles([readyPath, reviewPath]);
    await expect(page.locator('[data-protocol-import-item]')).toHaveCount(2, { timeout: 20_000 });
    await expect.poll(() => annualSummary(page, year), {
      timeout: 75_000,
      intervals: [500, 1000, 2000]
    }).toMatchObject({ total: 2, ready: 1, needs_review: 1, failed: 0 });
    await expect(page.locator('#protocol-import-summary')).toContainText('1 готово', { timeout: 5_000 });
    await expect(page.locator('#protocol-import-summary')).toContainText('1 проверить', { timeout: 5_000 });

    const reviewRow = page.locator('[data-protocol-import-item]').filter({ hasText: `Протокол ${year} проверить.txt` });
    await expect(reviewRow).toContainText('Не найден номер протокола');
    await expect(reviewRow).toContainText('Нужно сопоставить ответственного');
    await reviewRow.getByRole('button', { name: 'Исправить' }).click();

    await expect(page.locator('#meeting-detail')).toContainText('Нужно проверить 2');
    await page.locator('[data-edit-meeting]').click();
    const meetingForm = page.locator('#meeting-edit-form');
    await meetingForm.locator('[name="protocolNumber"]').fill('2');
    await meetingForm.locator('button[type="submit"]').click();
    await expect(page.locator('#meeting-modal')).toBeHidden();
    await expect(page.locator('#meeting-detail')).toContainText('Нужно проверить 1');

    const agenda = page.locator('[data-agenda-item]').filter({ hasText: 'О подготовке годового отчёта' });
    await agenda.getByRole('button', { name: 'Исправить' }).click();
    const agendaForm = page.locator('#agenda-item-form');
    await expect(agendaForm).toContainText('Нужно сопоставить ответственного');
    await agendaForm.locator('[name="responsibleRaw"]').fill('Сидоров Пётр Петрович');
    await agendaForm.locator('[name="dueDate"]').fill(`${year}-10-25`);
    await agendaForm.locator('button[type="submit"]').click();
    await expect(page.locator('#meeting-modal')).toBeHidden();
    await expect(page.locator('#meeting-detail')).not.toContainText('Нужно проверить');
    await expect(page.locator('#meeting-detail')).toContainText('Сидоров Пётр Петрович');
    await expect(page.locator('#meeting-detail')).toContainText('25 октября');
    await expect.poll(() => annualSummary(page, year), {
      timeout: 20_000,
      intervals: [500, 1000]
    }).toMatchObject({ total: 2, ready: 2, needs_review: 0, failed: 0 });
    await expect(page.locator('#protocol-import-summary')).toContainText('2 готово', { timeout: 5_000 });
    await expect(page.locator('#protocol-import-summary')).toContainText('0 проверить');

    await page.reload();
    await page.waitForFunction(() => document.querySelector('[data-view="meetings"]'), null, { timeout: 12_000 });
    await navigationButton(page).click();
    await expect(page.locator('#meeting-year-filter')).toHaveValue(String(year));
    await expect(page.locator('#protocol-import-summary')).toContainText('2 готово', { timeout: 12_000 });
    const uploadAfterReload = page.locator('#protocol-import-input');
    await uploadAfterReload.setInputFiles([readyPath, reviewPath]);
    await expect(page.locator('[data-protocol-import-item]')).toHaveCount(2, { timeout: 15_000 });
    const api = await page.request.get(`/api/protocol-imports?year=${year}`);
    expect(api.ok()).toBeTruthy();
    const result = await api.json();
    expect(result.summary).toMatchObject({ total: 2, ready: 2, needs_review: 0, failed: 0 });
    expect(result.items.find((item) => item.protocol_number === '2')?.meeting_date).toBe(`${year}-09-06`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
