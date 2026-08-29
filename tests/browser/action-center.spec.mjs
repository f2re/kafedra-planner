import { test, expect } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeZipArchive } from '../../packages/plan-docx/src/archive.mjs';

function cell(text) {
  return `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
}
function row(values) { return `<w:tr>${values.map(cell).join('')}</w:tr>`; }
async function createPlanDocx(path, marker) {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>ПЛАН РАБОТЫ КАФЕДРЫ</w:t></w:r></w:p>
<w:p><w:r><w:t>на 2026 год</w:t></w:r></w:p>
<w:tbl>${row(['№','Мероприятие','Срок проведения','Ответственный','Результат'])}${row(['1',marker,'15 сентября 2026','Иванов Иван Иванович','Протокол'])}</w:tbl>
</w:body></w:document>`;
  await writeZipArchive(path, {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': documentXml
  });
}

async function openCenter(page) {
  await page.goto('/');
  await expect(page.locator('#create-button')).toHaveText('+ Добавить');
  await page.locator('#create-button').click();
  await expect(page.locator('#action-center')).toBeVisible();
}

test('центр действий имеет стабильные три рекомендации, фиксированные группы и клавиатурный вход', async ({ page }) => {
  await openCenter(page);
  await expect(page.locator('#action-center-recommendations [data-action-center-action]')).toHaveCount(3);
  await expect(page.locator('#action-center-groups [data-action-center-group]')).toHaveCount(6);
  await expect(page.locator('#action-center-drop')).toContainText('назначение определится');
  await page.keyboard.press('Escape');
  await expect(page.locator('#action-center')).toBeHidden();
  await page.keyboard.press('Control+n');
  await expect(page.locator('#action-center')).toBeVisible();
});

test('плюс конкретного дня сохраняет domain-derived дату при создании задачи', async ({ page }) => {
  await page.goto('/');
  const day = page.locator('[data-new-on-date]:visible').first();
  await expect(day).toBeVisible();
  const date = await day.getAttribute('data-new-on-date');
  expect(date).toBeTruthy();
  await day.click();
  await expect(page.locator('#action-center')).toBeVisible();
  await expect(page.locator('#action-center-context')).toContainText('Выбранная дата важнее');
  await page.locator('[data-action-center-action="calendar.task.create"]').first().click();
  await expect(page.locator('#event-sheet')).toBeVisible();
  await expect(page.locator('#event-kind')).toHaveValue('task');
  await expect(page.locator('#event-date')).toHaveValue(date);
});

test('универсальная загрузка плана сохраняет исходник и открывает точный materialized plan', async ({ page }, testInfo) => {
  const dir = await mkdtemp(join(tmpdir(), `kafedra-action-center-${testInfo.project.name}-`));
  const marker = `Пункт из Action Center ${testInfo.project.name}`;
  const path = join(dir, `plan-action-center-${testInfo.project.name}.docx`);
  try {
    await createPlanDocx(path, marker);
    await openCenter(page);
    const uploaded = page.waitForResponse(
      (response) => response.url().endsWith('/api/documents') && response.request().method() === 'POST',
      { timeout: 15_000 }
    );
    await page.locator('#action-center-file').setInputFiles(path);
    expect((await uploaded).ok()).toBeTruthy();
    await expect(page.locator('[data-view-panel="plans"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#plan-detail')).toContainText(marker, { timeout: 30_000 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('неоднозначный обычный документ не угадывается и переводится только в Проверку', async ({ page }, testInfo) => {
  const dir = await mkdtemp(join(tmpdir(), `kafedra-action-center-unknown-${testInfo.project.name}-`));
  const path = join(dir, 'notes.txt');
  try {
    await writeFile(path, 'Служебная заметка без признаков плана, протокола, распоряжения или научной публикации.');
    await openCenter(page);
    await page.locator('#action-center-file').setInputFiles(path);
    await expect(page.locator('[data-view-panel="review"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#review-list')).toContainText(/Не определён тип документа|тип документа/i, { timeout: 30_000 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('prefers-reduced-motion сохраняет статическое состояние без пространственной анимации', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openCenter(page);
  const values = await page.locator('#action-center').evaluate((element) => {
    const style = getComputedStyle(element);
    return { duration: style.transitionDuration, recommendations: document.querySelectorAll('#action-center-recommendations [data-action-center-action]').length };
  });
  expect(values.recommendations).toBe(3);
  expect(values.duration).toMatch(/^(0s|0\.00001s)$/);
});
