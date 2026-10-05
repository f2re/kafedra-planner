// Shared assertions for the Playwright runner and the low-memory acceptance harness.
export async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(() => document.documentElement.dataset.workspaceUiReady === 'true');
}
const nav = (page, view) => view === 'search' ? page.locator('#open-search')
  : page.locator(`${page.viewportSize().width <= 720 ? '.mobile-tab' : '.nav-item'}[data-view="${view}"]`);
async function meetingForm(page) {
  await ready(page); await nav(page, 'meetings').click();
  await page.locator('#meeting-create-button').click();
}
const inWindow = (page, selector) => page.evaluate(s => document.querySelector(s).contains(document.activeElement), selector);
const unique = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;

export const workspaceCases = [
  ['Навигация и геометрия каждого раздела', async ({page, expect, layout}) => {
    await ready(page);
    const inspected = [];
    for (const width of layout === 'mobile' ? [393] : [360,768,1280,1920]) {
      await page.setViewportSize({width, height:960});
      const views = await page.locator('.nav-item[data-view]').evaluateAll(nodes => nodes.map(n=>n.dataset.view));
      for (const view of views) {
        await nav(page,view).click();
        const panel = page.locator(`[data-view-panel="${view}"]`);
        await expect(panel).toBeVisible();
        await expect(page.locator(`.nav-item[data-view="${view}"]`)).toHaveAttribute('aria-current','page');
        await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth), {message:`${view} ${width}px`}).toBeLessThanOrEqual(width+1);
        if(view==='calendar') for(const mode of ['week','tasks','month']) await page.locator(`[data-calendar-mode="${mode}"]`).click();
        const controls = await panel.locator('button,input,select,textarea,a[href],summary').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).map(n=>({tag:n.tagName,id:n.id,name:n.getAttribute('aria-label')||n.textContent.trim().slice(0,80)||n.labels?.[0]?.textContent.trim()||'',disabled:Boolean(n.disabled)})));
        inspected.push({width,view,controls});
      }
    }
    return inspected;
  }],
  ['Окно: клавиатура, изменённая форма, нативное подтверждение', async ({page,expect}) => {
    await meetingForm(page);
    const modal=page.locator('#meeting-modal');
    await expect(modal).toHaveAccessibleName('Дата и номер протокола');
    await expect.poll(()=>inWindow(page,'#meeting-modal')).toBe(true);
    for(let i=0;i<8;i++){await page.keyboard.press('Tab');await expect.poll(()=>inWindow(page,'#meeting-modal')).toBe(true);}
    await page.keyboard.press('Escape'); await expect(modal).toBeHidden();
    await expect(page.locator('#meeting-create-button')).toBeFocused();
    await page.locator('#meeting-create-button').click();
    await page.locator('#meeting-create-form [name="protocolNumber"]').fill('Не потерять правку');
    await page.keyboard.press('Escape');
    const guard=page.locator('.workspace-discard-dialog'); await expect(guard).toBeVisible();
    await page.keyboard.press('Control+n');await page.keyboard.press('Control+k');
    await expect(page.locator('#action-center')).toBeHidden();
    await expect(page.locator('[data-view-panel="meetings"]')).toBeVisible();
    await guard.getByRole('button',{name:'Продолжить редактирование'}).click();
    await expect(page.locator('#meeting-create-form [name="protocolNumber"]')).toHaveValue('Не потерять правку');
    await expect(page.locator('#meeting-create-form [name="protocolNumber"]')).toBeFocused();
    // Replacing an editor node is not evidence of a save (component-level contract).
    await page.locator('#meeting-create-form').evaluate(form=>form.replaceWith(form.cloneNode(true)));
    await page.keyboard.press('Escape');await expect(guard).toBeVisible();
    await guard.getByRole('button',{name:'Не сохранять',exact:true}).click();
    await expect(modal).toBeHidden();
    await expect(page.locator('#meeting-create-button')).toBeFocused();
  }],
  ['Ошибка и повтор сохраняют ввод и создают одно заседание', async ({page,expect}) => {
    await meetingForm(page);
    const form=page.locator('#meeting-create-form');const number=unique('UX');
    await form.locator('[name="meetingDate"]').fill('2049-09-15');
    await form.locator('[name="protocolNumber"]').fill(number);
    await page.route('**/api/meetings',route=>route.request().method()==='POST'
      ?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Временная ошибка сохранения'}})}) :route.continue(),{times:1});
    await form.getByRole('button',{name:'Создать',exact:true}).click();
    await expect(page.locator('body')).toContainText('Временная ошибка сохранения');
    await expect(form.locator('[name="protocolNumber"]')).toHaveValue(number);
    await form.getByRole('button',{name:'Создать',exact:true}).click();
    await expect(page.locator('#meeting-modal')).toBeHidden();
    await expect(page.locator('#meeting-detail')).toContainText(number);
    const response=await page.request.get('/api/meetings?year=2049');expect(response.ok()).toBeTruthy();
    const body=await response.json();expect(body.items.filter(x=>x.protocol_number===number)).toHaveLength(1);
  }],
  ['Центр действий: один выбор файла и семантика вкладок', async ({page,expect}) => {
    await ready(page);await page.locator('#create-button').click();
    const center=page.locator('#action-center');await expect(center).toBeVisible();
    let choices=0;page.on('filechooser',()=>choices++);
    const chooser=page.waitForEvent('filechooser');
    await page.locator('#action-center-dropzone').focus();await page.keyboard.press('Enter');
    await (await chooser).setFiles([]);expect(choices).toBe(1);
    await page.locator('#action-center-search').focus();await page.keyboard.press('Shift+Tab');
    await expect.poll(()=>inWindow(page,'#action-center')).toBe(true);
    await page.keyboard.press('Escape');await expect(center).toBeHidden();
    await page.locator('[data-calendar-mode="tasks"]').click();
    await expect(page.locator('[data-calendar-mode="tasks"]')).toHaveAttribute('aria-selected','true');
    await expect(page.locator('[data-calendar-mode="tasks"]')).not.toHaveAttribute('aria-pressed');
  }],
  ['Вложенная структура закрывает только дочернее окно', async ({page,expect}) => {
    await ready(page);await page.evaluate(()=>window.kafedraOpenOrganization());
    const parent=page.locator('#organization-shell-panel');await expect(parent).toBeVisible();
    const button=page.locator('[data-organization-add-unit]');await button.click();
    await expect(page.locator('#organization-modal')).toBeVisible();
    await page.keyboard.press('Escape');await expect(page.locator('#organization-modal')).toBeHidden();
    await expect(parent).toBeVisible();await expect(button).toBeFocused();
    await page.keyboard.press('Escape');await expect(parent).toBeHidden();
  }],
  ['Календарь: исправленная дата не сбрасывается при перерисовке', async ({page,expect}) => {
    const response=await page.request.post('/api/plans',{data:{title:unique('План UX'),planKind:'department',periodKind:'calendar',yearStart:2026,yearEnd:2026}});
    expect(response.ok()).toBeTruthy();await ready(page);
    await page.locator('[data-manual-calendar-add]').click();
    const form=page.locator('#manual-plan-item-form');await expect(form).toBeVisible();
    const date=form.locator('[name="startsAt"]');await date.fill('2026-09-10');
    await page.locator('#manual-plan-more-fields summary').click();
    await form.locator('[name="title"]').fill('Явная дата');
    await expect(date).toHaveValue('2026-09-10');
    await form.getByRole('button',{name:'Отмена',exact:true}).click();
    await expect(page.locator('#manual-plan-modal')).toBeHidden();
  }],
  ['Инспектор: отмена и сохранение возвращают к тому же объекту', async ({page,expect}) => {
    const today=new Date().toISOString().slice(0,10);const title=unique('Просмотр UX');
    const response=await page.request.post('/api/calendar',{data:{title,startsAt:today,kind:'task',category:'science',importance:'normal',allDay:true}});
    expect(response.ok()).toBeTruthy();const item=await response.json();
    await ready(page);await page.locator('[data-calendar-mode="tasks"]').click();await page.locator(`[data-calendar-item="${item.id}"]`).first().click();
    const inspector=page.locator('#ux-inspector');await expect(inspector).toBeVisible();
    await inspector.locator('[data-inspector-edit]').click();
    const form=page.locator('#event-form');await expect(form).toBeVisible();
    await form.getByRole('button',{name:'Отмена',exact:true}).click();
    await expect(inspector).toBeVisible();await expect(inspector).toContainText(title);
    await inspector.locator('[data-inspector-edit]').click();
    await page.locator('#event-title').fill(title+' изменено');
    await form.getByRole('button',{name:'Сохранить',exact:true}).click();
    await expect(form).toBeHidden();await expect(inspector).toContainText(title+' изменено');
    const saved=await page.request.get(`/api/calendar/${item.id}`);expect((await saved.json()).title).toBe(title+' изменено');
  }],
  ['Черновик: видимое предложение, сохранённый шаг и повторное открытие', async ({page,expect}) => {
    const label=unique('Документ UX');
    const uploaded=await page.request.post('/api/documents',{headers:{'content-type':'text/plain','x-file-name':encodeURIComponent(label+'.txt'),'idempotency-key':unique('ux-draft')},data:'Номер: 17\nДата: 15 сентября 2026 года\n'});
    expect(uploaded.ok()).toBeTruthy();const {documentId}=await uploaded.json();
    let source;
    await expect.poll(async()=>{const r=await page.request.get(`/api/templates/source?documentId=${documentId}`);source=await r.json();return Boolean(r.ok()&&source.version_id&&source.lines?.length);}).toBe(true);
    const line=source.lines.find(x=>x.text.includes('Номер:'));
    const payload={name:'Сохранённый UX-шаблон',documentType:'custom_document',step:3,fields:[{key:'nomer',label:'Номер',type:'string',strategy:'after_label',anchor:'Номер:',required:true,sample:line.text,sourceLineNumber:line.number}]};
    const saved=await page.request.put('/api/templates/draft',{data:{documentVersionId:source.version_id,step:3,payload}});expect(saved.ok()).toBeTruthy();
    await ready(page);await nav(page,'templates').click();
    for(let repeat=0;repeat<2;repeat++){
      await page.locator('#template-from-document').click();
      await page.locator('#template-document-select').selectOption(documentId);
      await page.locator('#template-load-document').click();
      await expect(page.locator('#resume-template-draft')).toBeVisible();
      await page.locator('#resume-template-draft').click();
      await expect(page.locator('[data-wizard-step="3"]')).toHaveClass(/active/);
      await expect(page.locator('#template-name')).toHaveValue(payload.name);
      await expect(page.locator('#template-fields .template-field')).toHaveCount(1);
      await page.locator('#template-sheet [data-close-sheet]').click();
      await expect(page.locator('#template-sheet')).toBeHidden();
    }
    await page.locator('#template-from-document').click();
    await page.locator('#template-document-select').selectOption(documentId);
    await page.locator('#template-load-document').click();
    await expect(page.locator('#resume-template-draft')).toBeVisible();
    await page.locator('[data-wizard-step="1"]').click();
    await expect(page.locator('[data-wizard-step="1"]')).toHaveAttribute('aria-current','step');
    await page.locator('#template-name').fill('Не воскресить удалённый черновик');
    await page.locator('#discard-template-draft').click();
    await expect(page.locator('#template-name')).toHaveValue('');
    await expect(page.locator('#template-fields .template-field')).toHaveCount(0);
    // Explicitly cover the 550ms autosave debounce after a confirmed discard.
    await page.waitForTimeout(700);
    const remaining=await page.request.get(`/api/templates/draft?documentVersionId=${source.version_id}`);
    expect((await remaining.json()).draft).toBeNull();
  }],
  ['Тёмная тема и уменьшенное движение сохраняют управление', async ({page,expect}) => {
    await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await meetingForm(page);
    await expect(page.locator('#meeting-modal')).toBeVisible();
    await expect.poll(()=>inWindow(page,'#meeting-modal')).toBe(true);
    await expect(page.locator('#meeting-modal')).toHaveCSS('animation-name','none');
    await page.keyboard.press('Escape');await expect(page.locator('#meeting-create-button')).toBeFocused();
  }]
];
