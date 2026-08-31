import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeZipArchive } from '../../packages/plan-docx/src/archive.mjs';

function cell(text) {
  return `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
}

function row(values) {
  return `<w:tr>${values.map(cell).join('')}</w:tr>`;
}

async function createPlanDocx(path, marker) {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>ПЛАН РАБОТЫ КАФЕДРЫ</w:t></w:r></w:p>
<w:p><w:r><w:t>на 2026 год</w:t></w:r></w:p>
<w:tbl>
${row(['№', 'Мероприятие', 'Срок проведения', 'Ответственный', 'Результат'])}
${row(['1', marker, '15 сентября 2026', 'Иванов Иван Иванович', 'Протокол'])}
</w:tbl><w:sectPr/></w:body></w:document>`;
  await writeZipArchive(path, {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': documentXml
  });
}

async function openApplication(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.kafedraOpenActionCenter === 'function');
}

test('центр имеет стабильную структуру, работает с клавиатуры и сохраняет дату дня', async ({ page }) => {
  await openApplication(page);
  const create = page.locator('#create-button');
  await expect(create).toHaveText('+ Добавить');
  await create.click();
  const center = page.locator('#action-center');
  await expect(center).toBeVisible();
  await expect(center.locator('#action-center-recommendations > *')).toHaveCount(3);
  await expect(center.locator('[data-action-group]')).toHaveCount(7);

  await page.locator('#action-center-search').fill('протокол');
  await expect(center.locator('[data-action-id="meeting.upload"]').first()).toBeVisible();
  await expect(center.locator('[data-action-group]')).toHaveCount(7);
  await page.keyboard.press('Escape');
  await expect(center).toBeHidden();
  await expect(create).toBeFocused();

  await page.keyboard.press('Control+n');
  await expect(center).toBeVisible();
  await center.locator('[data-action-id="calendar.task"]').first().click();
  await expect(page.locator('#event-sheet')).toBeVisible();
  await expect(page.locator('#event-kind')).toHaveValue('task');
  await page.locator('#event-sheet [data-close-sheet]').first().click();

  const dayAction = page.locator('[data-new-on-date]').first();
  await dayAction.scrollIntoViewIfNeeded();
  await expect(dayAction).toBeVisible();
  const explicitDate = await dayAction.getAttribute('data-new-on-date');
  expect(explicitDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  await dayAction.click();
  await expect(center).toBeVisible();
  await center.locator('[data-action-id="calendar.event"]').first().click();
  await expect(page.locator('#event-sheet')).toBeVisible();
  await expect(page.locator('#event-date')).toHaveValue(explicitDate);
});


test('центр запускает существующий импорт ведомости без дублирования формы', async ({ page }) => {
  await openApplication(page);
  await page.locator('#create-button').click();
  const center = page.locator('#action-center');
  await page.locator('#action-center-search').fill('ведомость');
  const action = center.locator('[data-action-id="academic.import"]').first();
  await expect(action).toBeVisible();
  await action.click();
  await expect(center).toBeHidden();
  await expect(page.locator('[data-view-panel="academic-performance"]')).toBeVisible();
  await expect(page.locator('[data-academic-modal]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Загрузить ведомость' })).toBeVisible();
});

test('универсальная загрузка открывает точный созданный план', async ({ page }, testInfo) => {
  const dir = await mkdtemp(join(tmpdir(), `kafedra-action-center-${testInfo.project.name}-`));
  const marker = `Адаптивный маршрут ${testInfo.project.name} ${Date.now()}`;
  const path = join(dir, `План ${marker}.docx`);
  try {
    await createPlanDocx(path, marker);
    await openApplication(page);
    await page.locator('#create-button').click();
    const uploadResponse = page.waitForResponse(
      (response) => response.url().endsWith('/api/documents') && response.request().method() === 'POST',
      { timeout: 20_000 }
    );
    await page.locator('#action-center-file').setInputFiles(path);
    expect((await uploadResponse).ok()).toBeTruthy();
    await expect(page.locator('[data-view-panel="plans"]')).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('#plan-detail')).toContainText(marker, { timeout: 45_000 });
    await expect(page.locator('#action-center')).toBeHidden();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('reduced motion оставляет понятное статическое состояние', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApplication(page);
  await page.locator('#create-button').click();
  await expect(page.locator('#action-center')).toBeVisible();
  const motion = await page.locator('#action-center').evaluate((element) => {
    const style = getComputedStyle(element);
    return { animationName: style.animationName, transitionDuration: style.transitionDuration };
  });
  expect(motion.animationName).toBe('none');
  expect(motion.transitionDuration).toBe('0s');
  await expect(page.locator('#action-center-title')).toHaveText('Что нужно сделать?');
  await expect(page.locator('#action-center-recommendations > *')).toHaveCount(3);
  await expect(page.locator('[data-action-group]')).toHaveCount(7);
});
