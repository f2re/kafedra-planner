import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { writeZipArchive } from '../../../packages/plan-docx/src/archive.mjs';
function cell(text) {
  return `<w:tc><w:tcPr><w:tcW w:w="1500" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
}
function row(values) { return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${values.map(cell).join('')}</w:tr>`; }
function planXml(responsibleName) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>ПЛАН РАБОТЫ КАФЕДРЫ</w:t></w:r></w:p>
<w:p><w:r><w:t>на 2026 календарный год</w:t></w:r></w:p>
<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr>
${row(['№', 'Мероприятие', 'Основание', 'Срок проведения', 'Ответственный', 'Результат'])}
${row(['1', 'Подготовить материалы и провести обсуждение', 'Решение учёного совета № 7', 'до 20 октября 2026', responsibleName, 'Комплект материалов'])}
${row(['2', 'Подготовить отдельный отчёт', 'Приложение 2', 'до 25 октября 2026', responsibleName, 'Отчёт'])}
</w:tbl><w:sectPr/></w:body></w:document>`;
}
async function createDocx(path, responsibleName) {
  await writeZipArchive(path, {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': planXml(responsibleName)
  });
}


const unique=prefix=>`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
async function ready(page) { await page.goto('/'); await page.waitForFunction(()=>document.documentElement.dataset.workspaceUiReady==='true'); }
const nav=(page,name)=>page.locator(`${page.viewportSize().width<=720?'.mobile-tab':'.nav-item'}[data-view="${name}"]`);
async function importedPlan(page,expect) {
  const name=unique('Исполнитель');
  const personResponse=await page.request.post('/api/people',{data:{displayName:name}});expect(personResponse.ok()).toBeTruthy();
  const person=await personResponse.json();
  const dir=await mkdtemp(join(tmpdir(),'kafedra-r2-')); const file=join(dir,unique('План')+'.docx');
  try {
    await createDocx(file,name);await ready(page);await nav(page,'plans').click();
    const upload=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/documents'&&r.request().method()==='POST');
    await page.locator('#plans-upload-input').setInputFiles(file);
    const uploaded=await upload;expect(uploaded.ok()).toBeTruthy();
    const documents=await(await page.request.get('/api/documents?limit=500')).json();
    const documentId=documents.items.find(x=>x.original_name===basename(file))?.id;expect(documentId).toBeTruthy();
    let id;
    await expect.poll(async()=>{const response=await page.request.get('/api/plans?limit=500');id=(await response.json()).items.find(x=>x.source_document_id===documentId)?.id;return Boolean(id);},{timeout:30000}).toBe(true);
    await expect(page.locator('.plan-card.active')).toHaveAttribute('data-plan-id',id);
    await expect(page.locator('#plans-notice')).toContainText('План загружен');
    await expect(page.locator('#plan-source-workbench')).toBeVisible({timeout:30000});
    await page.locator('[data-plan-source-filter="all"]').click();
    const rows=await(await page.request.get(`/api/plans/${id}/source-rows`)).json();
    const a=rows.items.find(x=>x.rawText.includes('Подготовить материалы'));
    const b=rows.items.find(x=>x.rawText.includes('Подготовить отдельный'));
    expect(a?.id).toBeTruthy();expect(b?.id).toBeTruthy();
    return {id,a,b,person};
  } finally {await rm(dir,{recursive:true,force:true});}
}
const rowButton=(page,id)=>page.locator(`[data-plan-source-row="${id}"]`);
async function manualTask(page,expect) {
  const title=unique('Поручение R2');
  const person=await(await page.request.post('/api/people',{data:{displayName:unique('Сотрудник')}})).json();
  const plan=await(await page.request.post('/api/plans',{data:{title,planKind:'department',periodKind:'calendar',yearStart:2026,yearEnd:2026}})).json();
  const response=await page.request.post(`/api/plans/${plan.id}/items`,{data:{title,direction:'organizational',executionMode:'assigned',executorPersonIds:[person.id],dueDate:'2026-12-20'}});
  expect(response.ok()).toBeTruthy();
  const stored=await(await page.request.get(`/api/plans/${plan.id}`)).json();return {plan,item:stored.items.find(x=>x.title===title),title};
}
export const r2Cases=[
 ['Исходная строка: правки, фильтры, закрытие, отмена, ошибка и повтор',async({page,expect})=>{
  const {id,a,b,person}=await importedPlan(page,expect);
  await rowButton(page,a.id).click();const form=page.locator('#plan-source-form');
  const first=form.locator('[data-source-task="0"]');
  await first.locator('[name="title"]').fill('Исправленное название  ');
  await first.locator('[name="description"]').fill('Первая строка\nВторая строка');
  await first.locator('[name="dueDate"]').fill('2026-11-20');
  await first.locator('[name="executionMode"]').selectOption('assigned');
  await first.locator(`[name="executor"][value="${person.id}"]`).check();
  await form.locator('[data-source-task-add]').click();
  await form.locator('[data-source-task="1"] [name="title"]').fill('Отдельная задача');
  await form.locator('[data-source-task-add]').click();
  await form.locator('[data-source-task="2"] [name="title"]').fill('Убрать эту подготовленную задачу');
  await form.locator('[data-source-task-remove="2"]').click();
  await expect(form.locator('[data-source-task]')).toHaveCount(2);
  const keep=form.locator('[name="keepUnmapped"]');if(await keep.count())await keep.uncheck();
  await rowButton(page,b.id).click();await page.locator('#plan-source-form [name="title"]').fill('Черновик соседней строки');
  await page.locator('[data-source-editor-close]').click();await expect(rowButton(page,b.id)).toBeFocused();
  await page.locator('[data-plan-source-filter="attention"]').click();
  await expect(page.locator('[data-plan-source-filter="attention"]')).toHaveAttribute('aria-pressed','true');
  await page.locator('[data-plan-source-filter="all"]').click();await rowButton(page,a.id).click();
  await expect(first.locator('[name="title"]')).toHaveValue('Исправленное название  ');
  await expect(first.locator('[name="description"]')).toHaveValue('Первая строка\nВторая строка');
  await expect(first.locator('[name="dueDate"]')).toHaveValue('2026-11-20');
  await expect(first.locator(`[name="executor"][value="${person.id}"]`)).toBeChecked();
  await expect(form.locator('[data-source-task]')).toHaveCount(2);if(await keep.count())await expect(keep).not.toBeChecked();
  await expect(form.locator('[data-source-save-status]')).toContainText('ещё не сохранены');
  await page.route(`**/api/plans/${id}/source-rows/${a.id}/materialize`,r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Проверяемая ошибка записи'}})}),{times:1});
  await form.getByRole('button',{name:'Сохранить задачи',exact:true}).click();
  await expect(form.locator('[data-source-save-status]')).toContainText('Проверяемая ошибка записи');
  await expect(first.locator('[name="title"]')).toHaveValue('Исправленное название  ');
  await form.getByRole('button',{name:'Сохранить задачи',exact:true}).click();
  await expect(page.locator('#plans-notice')).toContainText('Сохранено задач: 2');
  const saved=await(await page.request.get(`/api/plans/${id}`)).json();
  expect(saved.items.some(x=>x.title==='Исправленное название'&&x.due_date==='2026-11-20'&&x.assignment)).toBeTruthy();
  await expect(rowButton(page,b.id)).toBeVisible();await rowButton(page,b.id).click();
  await expect(page.locator('#plan-source-form [name="title"]')).toHaveValue('Черновик соседней строки');
  await page.locator('[data-source-draft-reset]').click();
  await expect(page.locator('#plan-source-form [name="title"]')).toHaveValue('Подготовить отдельный отчёт');
  await rowButton(page,a.id).click();await expect(form.locator('[data-source-task-remove]')).toHaveCount(0);
  await page.reload();await page.waitForFunction(()=>typeof window.kafedraOpenPlan==='function');await page.evaluate(id=>window.kafedraOpenPlan(id),id);
  await expect(page.locator('#plan-source-workbench')).toBeVisible();await page.locator('[data-plan-source-filter="all"]').click();await rowButton(page,a.id).click();
  await expect(first.locator('[name="title"]')).toHaveValue('Исправленное название');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width+1);
 }],
 ['Сохранение: повторный submit и поздний ответ не меняют другой план',async({page,expect})=>{
  const {id,a,b}=await importedPlan(page,expect);const other=await manualTask(page,expect);
  await rowButton(page,a.id).click();const form=page.locator('#plan-source-form');
  await form.locator('[name="title"]').fill('Сохранить без возврата');
  let release,received;const gate=new Promise(r=>release=r);const entered=new Promise(r=>received=r);let requests=0;
  await page.route(`**/api/plans/${id}/source-rows/${a.id}/materialize`,async route=>{requests++;const result=await route.fetch();received();await gate;await route.fulfill({response:result});});
  try {
   await form.getByRole('button',{name:'Сохранить задачи',exact:true}).click();await entered;
   await form.evaluate(f=>f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
   await rowButton(page,b.id).click();
   await expect(page.locator('#plan-source-form button[type="submit"]')).toBeDisabled();
   await page.locator('#plan-source-form [name="title"]').fill('Продолжаю редактирование');
   await page.evaluate(id=>window.kafedraOpenPlan(id),other.plan.id);
   await expect(page.locator('.plan-card.active')).toHaveAttribute('data-plan-id',other.plan.id);
   release();await expect(page.locator('#plans-notice')).toContainText('Сохранено задач');
   await expect(page.locator('.plan-card.active')).toHaveAttribute('data-plan-id',other.plan.id);
   expect(requests).toBe(1);
   await page.evaluate(id=>window.kafedraOpenPlan(id),id);await expect(page.locator('#plan-source-workbench')).toBeVisible();
   await page.locator('[data-plan-source-filter="all"]').click();await rowButton(page,b.id).click();
   await expect(page.locator('#plan-source-form [name="title"]')).toHaveValue('Продолжаю редактирование');
  } finally {release?.();}
 }],
 ['Фильтр проверки не подменяется всеми строками',async({page,expect})=>{
  const {id}=await importedPlan(page,expect);
  await page.route(`**/api/plans/${id}/source-rows`,async route=>{const r=await route.fetch();const body=await r.json();body.summary.attention=0;body.items.forEach(x=>x.attention=false);await route.fulfill({response:r,json:body});});
  const loaded=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/plans/${id}/source-rows`);
  await page.evaluate(id=>window.kafedraOpenPlan(id),id);await loaded;
  await expect(page.locator('.plan-source-summary')).toContainText('0 проверить');
  await page.locator('[data-plan-source-filter="attention"]').click();
  await expect(page.locator('.plan-source-list')).toContainText('Нет строк, требующих проверки');await expect(page.locator('[data-plan-source-row]')).toHaveCount(0);
  await page.locator('[data-plan-source-filter="all"]').click();await expect(page.locator('[data-plan-source-row]').first()).toBeVisible();
 }],
 ['Поручение: материалы недоступны, выполнение сохраняется и ввод файла остаётся',async({page,expect})=>{
  const {plan,item,title}=await manualTask(page,expect);const id=item.assignment.id;
  await page.route('**/api/documents?limit=500*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Материалы временно недоступны'}})}));
  await ready(page);await nav(page,'work').click();
  await expect(page.locator(`[data-work-id="${id}"]`)).toBeVisible();await expect(page.locator('#work-summary')).toContainText('Список материалов недоступен');
  await page.evaluate(id=>window.kafedraOpenStandaloneAssignment(id),id);
  const inspector=page.locator('#standalone-assignment-inspector');await expect(inspector).toContainText(title);
  await expect(inspector.locator('[data-standalone-documents-status]')).toContainText('Выполнение задачи');
  const material=page.locator('[data-standalone-report-form]');await material.locator('[name="note"]').fill('Не терять при выполнении');
  await material.locator('[name="file"]').setInputFiles({name:'material.txt',mimeType:'text/plain',buffer:Buffer.from('Необязательный материал')});
  let count=0;await page.route(`**/api/assignments/${id}/progress`,async route=>{count++;await route.continue();});
  await page.route('**/api/work/search?**',route=>route.fulfill({status:503,json:{error:{message:'Обзор недоступен'}}}));
  await inspector.getByRole('button',{name:'Выполнено',exact:true}).click();
  await expect(inspector).toContainText('Задача выполнена');await expect(inspector).toContainText('сохранённый результат не отменён');
  await expect(material.locator('[name="note"]')).toHaveValue('Не терять при выполнении');expect(await material.locator('[name="file"]').evaluate(i=>i.files.length)).toBe(1);
  expect(count).toBe(1);const saved=await(await page.request.get(`/api/plans/${plan.id}`)).json();expect(saved.items.find(x=>x.id===item.id).status).toBe('completed');
  await page.unroute('**/api/documents?limit=500*');await material.locator('[data-standalone-documents-retry]').click();
  await expect(material.locator('[data-standalone-documents-status]')).not.toContainText('недоступен');
  await inspector.getByRole('button',{name:'Вернуть в работу',exact:true}).click();await expect(inspector).toContainText('Задача возвращена в работу');
  expect((await(await page.request.get(`/api/plans/${plan.id}`)).json()).items.find(x=>x.id===item.id).status).toBe(item.status);
 }]
];
