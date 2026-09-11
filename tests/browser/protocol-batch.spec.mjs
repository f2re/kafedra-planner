import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const sample=await readFile(new URL('../fixtures/protocol-separate-agenda.txt',import.meta.url),'utf8');

async function summary(page,year) {return (await (await page.request.get(`/api/protocol-imports?year=${year}`)).json()).summary;}

test('Протоколы: массовая правка с частичной ошибкой → формат → повтор → сохранённые вопросы',async({page},testInfo)=>{
  const year=testInfo.project.name==='mobile'?2049:2048;
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.kafedraOpenMeeting==='function');
  const nav=Number(page.viewportSize()?.width || 0)<=720?'.mobile-tab[data-view="meetings"]':'.nav-item[data-view="meetings"]';
  await page.locator(nav).click();await page.locator('#meeting-year-filter').fill(String(year));await page.locator('#meeting-year-filter').blur();
  const files=[{name:`Стандарт ${year}.txt`,mimeType:'text/plain',buffer:Buffer.from(sample.replaceAll('2026',String(year)))},
    {name:`Особый ${year}.txt`,mimeType:'text/plain',buffer:Buffer.from(sample.replaceAll('2026',String(year)).replace('№ 25','№ 26').replaceAll('Решение:','Итоговое заключение:'))}];
  await page.locator('#protocol-import-input').setInputFiles(files);
  await expect.poll(()=>summary(page,year)).toMatchObject({total:2,processing:0,needs_review:2});
  await expect(page.locator('#protocol-import-summary')).toContainText('2 проверить');
  await page.getByRole('button',{name:'Выбрать видимые',exact:true}).click();
  await page.getByRole('button',{name:'Править реквизиты',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Массовая правка протоколов'});
  const normal=dialog.locator('.protocol-bulk-row').filter({hasText:`Стандарт ${year}.txt`});
  const custom=dialog.locator('.protocol-bulk-row').filter({hasText:`Особый ${year}.txt`});
  for(const row of [normal,custom]) {await row.getByLabel('Дата заседания',{exact:true}).fill(`${year}-07-05`);await row.getByLabel('Номер',{exact:true}).fill('same-number');}
  await dialog.getByRole('button',{name:'Сохранить правки',exact:true}).click();
  await expect(dialog.locator('form > [role=status]')).toContainText('Сохранено: 1. Ошибок: 1.');
  await expect(dialog).toContainText('Заседание с таким номером и датой уже существует.');
  await normal.getByLabel('Номер',{exact:true}).fill('25');await custom.getByLabel('Номер',{exact:true}).fill('26');
  await custom.getByLabel('Дата заседания',{exact:true}).fill(`${year}-07-06`);
  await normal.getByLabel('Секретарь',{exact:true}).fill('Проверенный секретарь');
  await dialog.getByRole('button',{name:'Сохранить правки',exact:true}).click();
  await expect(dialog.locator('form > [role=status]')).toContainText('Сохранено: 2. Ошибок: 0.');
  await expect.poll(()=>dialog.evaluate((el)=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
  await expect.poll(()=>summary(page,year)).toMatchObject({total:2,ready:1,needs_review:1});
  await page.getByRole('button',{name:'Снять выбор',exact:true}).click();
  await page.getByLabel('Фильтр протоколов').selectOption('attention');
  const special=page.locator('[data-protocol-import-item]').filter({hasText:`Особый ${year}.txt`});
  await expect(special).toBeVisible();await special.getByRole('checkbox').check();
  await page.getByRole('button',{name:'Настроить распознавание',exact:true}).click();
  const format=page.getByRole('dialog',{name:'Формат распознавания протокола'});
  await format.getByLabel('Название',{exact:true}).fill(`Формат ${year}`);
  await format.getByLabel('Часть имени файла (необязательно)',{exact:true}).fill(`Особый ${year}`);
  await format.getByLabel('Решение',{exact:true}).fill('Итоговое заключение');
  await expect(format.getByRole('button',{name:'Сохранить формат'})).toBeDisabled();
  await format.getByRole('button',{name:'Проверить на образце'}).click();
  await expect(format.locator('[role=status]')).toContainText('Найдено вопросов: 3');
  await expect(format.locator('.protocol-tools-result')).toContainText('Рекомендовать статью');
  await format.getByRole('button',{name:'Сохранить формат'}).click();
  await expect(format.locator('[role=status]')).toContainText('Сохранена версия 1');
  await expect.poll(()=>format.evaluate((el)=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await format.getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.getByRole('button',{name:'Повторить выбранные',exact:true}).click();
  await expect.poll(()=>summary(page,year)).toMatchObject({total:2,ready:2,needs_review:0,failed:0});
  await page.getByLabel('Фильтр протоколов').selectOption('all');
  const response=await page.request.get(`/api/protocol-imports?year=${year}`);const imported=await response.json();
  expect(imported.items.map((item)=>item.agenda_count)).toEqual([3,3]);
  const source=imported.items.find((item)=>item.protocol_number==='25');
  const metadata=await (await page.request.get(`/api/protocol-imports/tools?documentId=${source.document_id}`)).json();
  expect(metadata.fields.secretary).toBe('Проверенный секретарь');
  await page.locator('#protocol-import-input').setInputFiles(files);
  await expect.poll(()=>summary(page,year)).toMatchObject({total:2,ready:2});
  await page.reload();await page.waitForFunction(()=>typeof window.kafedraOpenMeeting==='function');await page.locator(nav).click();
  await expect(page.locator('#protocol-import-summary')).toContainText('2 готово');
  await page.screenshot({path:testInfo.outputPath('protocol-import-ready.png'),fullPage:false});
});
