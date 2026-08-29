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

async function importedMeetings(page, originalName) {
  const response = await page.request.get('/api/meetings?limit=500');
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = await response.json();
  return (body.items || []).filter((meeting) => meeting.source_original_name === originalName);
}

test('Заседания: загрузить протокол → сразу открыть заседание → исправить → повторить без дубля', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), `kafedra-meeting-import-${testInfo.project.name}-`));
  const originalName = `Протокол кафедры ${testInfo.project.name}.txt`;
  const filePath = join(directory, originalName);
  const protocolNumber = testInfo.project.name === 'mobile' ? '52' : '51';
  const meetingDate = testInfo.project.name === 'mobile' ? '2026-10-16' : '2026-10-15';
  const correctedTitle = `Исправленное заседание ${testInfo.project.name}`;
  try {
    await writeFile(filePath, `ПРОТОКОЛ ЗАСЕДАНИЯ КАФЕДРЫ № ${protocolNumber}\n${meetingDate.split('-').reverse().join('.')}\nПредседатель: Иванов Иван Иванович\nСекретарь: Петрова Анна Сергеевна\nПОВЕСТКА ДНЯ\n1. О подготовке годового плана кафедры.\nСЛУШАЛИ: Доклад заведующего кафедрой.\nРЕШИЛИ: Подготовить проект годового плана до 20 октября 2026 года.`, 'utf8');

    await page.goto('/');
    await page.waitForFunction(() => document.querySelector('[data-view="meetings"]'), null, { timeout: 15_000 });
    await navigationButton(page).click();
    await expect(page.locator('[data-view-panel="meetings"]')).toBeVisible();
    await expect(page.locator('#meeting-source-upload-button')).toBeVisible();
    await expect(page.locator('#meeting-settings-summary')).toContainText('Загруженный протокол создаёт заседание без настройки шаблонов');

    const uploadRequest = page.waitForRequest((request) =>
      new URL(request.url()).pathname === '/api/documents' && request.method() === 'POST'
    );
    await page.locator('#meeting-source-upload-input').setInputFiles(filePath);
    const request = await uploadRequest;
    expect(request.headers()['x-document-type']).toBe('protocol');
    expect(request.headers()['idempotency-key']).toMatch(/^[\x20-\x7e]+$/u);

    await expect(page.locator('#meeting-detail')).toContainText(`Протокол №${protocolNumber}`, { timeout: 45_000 });
    await expect(page.locator('#meeting-detail')).toContainText('О подготовке годового плана кафедры');
    await expect(page.locator('#meeting-detail')).toContainText('Создано из протокола');
    await expect(page.locator('#meeting-detail a', { hasText: 'Исходный документ' })).toBeVisible();
    await expect(page.locator('#meeting-modal')).toBeHidden();
    await expect(page.locator('.meeting-card.active')).toContainText('загружен из документа');

    const firstItems = await importedMeetings(page, originalName);
    expect(firstItems).toHaveLength(1);
    const meetingId = firstItems[0].id;

    await page.locator('[data-edit-meeting]').click();
    const form = page.locator('#meeting-edit-form');
    await expect(form).toBeVisible();
    await form.locator('[name="title"]').fill(correctedTitle);
    await form.locator('button[type="submit"]').click();
    await expect(page.locator('#meeting-modal')).toBeHidden();
    await expect(page.locator('#meeting-detail')).toContainText(correctedTitle);

    const repeatedRequest = page.waitForRequest((candidate) =>
      new URL(candidate.url()).pathname === '/api/documents' && candidate.method() === 'POST'
    );
    await page.locator('#meeting-source-upload-input').setInputFiles(filePath);
    await repeatedRequest;
    await expect(page.locator('#meeting-detail')).toContainText(correctedTitle, { timeout: 45_000 });
    await expect(page.locator('#meeting-detail')).toContainText(`Протокол №${protocolNumber}`);

    const repeatedItems = await importedMeetings(page, originalName);
    expect(repeatedItems).toHaveLength(1);
    expect(repeatedItems[0].id).toBe(meetingId);
    expect(repeatedItems[0].title).toBe(correctedTitle);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
