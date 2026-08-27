const workState={items:[],people:[],documents:[],status:'',currentPersonId:null};
const q=(selector,root=document)=>root.querySelector(selector);
const qa=(selector,root=document)=>[...root.querySelectorAll(selector)];
const e=(value)=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const formatDate=(value)=>value?new Date(value).toLocaleDateString('ru-RU'):'—';
const authContext=await window.kafedraAuthReady;

function ensureWorkStyles(){
  if(q('#work-direct-completion-styles')) return;
  const style=document.createElement('style');
  style.id='work-direct-completion-styles';
  style.textContent=`
    .assignment-progress-panel,.assignment-evidence-panel{display:grid;gap:10px;margin-top:14px;padding:14px;border:1px solid var(--border,#dce3ea);border-radius:14px;background:var(--surface-soft,#f8fafc)}
    .assignment-progress-panel h6,.assignment-evidence-panel h6{margin:0;font-size:15px}.assignment-progress-panel p,.assignment-evidence-panel p{margin:0;color:var(--muted,#64748b)}
    .assignment-progress-form,.work-report-form{display:grid;gap:9px}.assignment-progress-form input,.assignment-progress-form textarea,.work-report-form input,.work-report-form select,.work-report-form textarea{width:100%;box-sizing:border-box}
    .assignment-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.assignment-evidence-history{display:grid;gap:6px;margin:0;padding-left:20px}.assignment-evidence-history small{display:block;color:var(--muted,#64748b)}
    .assignment-notice{margin:10px 0 0;padding:10px 12px;border-radius:12px;background:var(--surface-soft,#f8fafc)}.standalone-upload-state{font-size:13px}.hidden{display:none!important}
  `;
  document.head.append(style);
}

function ensureWorkPanel(){
  ensureWorkStyles();
  const panel=q('[data-view-panel="work"]');
  if(!panel||q('#work-filter-form',panel)) return;
  panel.innerHTML=`
    <div class="section-header"><div><h2>Поручения</h2><p>Все задачи из планов, распоряжений и регулярной работы. Одно действие завершает задачу.</p></div></div>
    <form id="work-filter-form" class="toolbar work-toolbar">
      <input name="q" type="search" placeholder="Поиск по поручениям">
      <select name="status"><option value="">Все состояния</option><option value="open">В работе</option><option value="completed">Выполнено</option><option value="cancelled">Отменено</option></select>
      <select name="direction"><option value="">Все направления</option><option value="science">Наука</option><option value="education">Учебная работа</option><option value="organizational">Организационная работа</option><option value="personnel">Кадры</option><option value="safety">Безопасность</option><option value="finance">Финансы</option><option value="digital">Цифровая среда</option></select>
      <select name="personId"><option value="">Все сотрудники</option></select>
      <select name="role"><option value="">Все роли</option><option value="executor">Исполнитель</option><option value="coexecutor">Соисполнитель</option><option value="controller">Контролирующий</option></select>
      <button class="secondary-button" type="submit">Показать</button>
    </form>
    <div id="work-stats" class="stats-grid"></div>
    <div class="work-layout"><div id="work-list" class="work-list"></div><div id="work-results" class="work-results"></div></div>
  `;
}

async function workApi(path,options={}){
  const response=await fetch(path,options);
  if(response.status===401&&authContext?.authEnabled!==false){
    await window.kafedraAuth.requireAuth();
    throw new Error('Требуется вход');
  }
  if(!response.ok){
    const payload=await response.json().catch(()=>({}));
    throw new Error(payload.message||payload.error?.message||`Ошибка ${response.status}`);
  }
  return await response.json();
}

async function loadPeople(){
  const data=await workApi('/api/people');
  workState.people=(data.items||[]).filter((person)=>person.status!=='inactive');
  const select=q('#work-filter-form [name="personId"]');
  if(select) select.innerHTML='<option value="">Все сотрудники</option>'+workState.people.map((person)=>`<option value="${e(person.id)}">${e(person.display_name)}</option>`).join('');
}

async function loadDocuments(){
  const data=await workApi('/api/documents?limit=1000');
  workState.documents=data.items||[];
}

function statusLabel(status){
  if(status==='completed') return 'Выполнено';
  if(status==='cancelled') return 'Отменено';
  return 'В работе';
}
function isWorkingStatus(status){return !['completed','cancelled'].includes(String(status||''));}
function roleLabel(role){return({executor:'Исполнитель',coexecutor:'Соисполнитель',controller:'Контролирующий',observer:'Наблюдатель'}[role]||role||'');}
function itemStatus(item){return item.status||'open';}
function sourceKind(item){return item.directive?'directive':item.periodicTask?'periodic':'assignment';}
function sourceTitle(item){return item.directive?.title||item.periodicTask?.title||item.title||'Поручение';}
function itemDeadline(item){return item.due_date||item.ends_at||item.periodicTask?.due_date||null;}

function workCard(item){
  const kind=sourceKind(item);
  const source=kind==='directive'?'Распоряжение':kind==='periodic'?'Регулярная задача':'Поручение';
  const overdue=itemDeadline(item)&&new Date(itemDeadline(item))<new Date()&&itemStatus(item)!=='completed';
  return `<button type="button" class="work-card" data-work-item="${e(item.id)}" data-kind="${kind}">
    <span class="work-card-source">${source}</span>
    <strong>${e(sourceTitle(item))}</strong>
    <span>${e(item.responsible_person_name||item.owner_person_name||'Без исполнителя')}</span>
    <span>${roleLabel(item.role||'executor')} · ${overdue?'Срок прошёл':formatDate(itemDeadline(item))}</span>
    <span class="status">${e(statusLabel(itemStatus(item)))}</span>
  </button>`;
}

function renderWork(data){
  if(data) workState.items=data.items||[];
  const list=q('#work-list');
  const stats=q('#work-stats');
  if(!list||!stats) return;
  const items=workState.items;
  const completed=items.filter((item)=>itemStatus(item)==='completed').length;
  const cancelled=items.filter((item)=>itemStatus(item)==='cancelled').length;
  stats.innerHTML=`<div class="stat-card"><span>Всего</span><strong>${items.length}</strong></div><div class="stat-card"><span>В работе</span><strong>${items.length-completed-cancelled}</strong></div><div class="stat-card"><span>Выполнено</span><strong>${completed}</strong></div>`;
  list.innerHTML=items.length?items.map(workCard).join(''):'<div class="empty-state">Поручений по выбранным условиям нет.</div>';
}

function documentOptions(){
  return workState.documents.map((document)=>`<option value="${e(document.id)}">${e(document.title||document.original_name||'Документ')}</option>`).join('');
}

function assignmentHistory(assignment){
  const reports=assignment.reports||[];
  if(!reports.length) return '<p>Материалы не приложены. Для выполнения они не нужны.</p>';
  return `<ul class="assignment-evidence-history">${reports.map((report)=>`<li>${report.document_id?`<a href="/api/documents/${encodeURIComponent(report.document_id)}/download">${e(report.document_title||'Открыть материал')}</a>`:e(report.note||'Материал')}<small>${e(report.note||'')} · ${formatDate(report.submitted_at)}</small></li>`).join('')}</ul>`;
}

function assignmentProgressPanel(assignment){
  if(assignment.status==='cancelled') return '<section class="assignment-progress-panel"><h6>Задача отменена</h6><p>Её можно отредактировать в исходном документе или поручении.</p></section>';
  const completed=assignment.status==='completed';
  const latest=(assignment.progress||assignment.updates||[])[0]||null;
  return `<section class="assignment-progress-panel">
    <h6>${completed?'Задача выполнена':'Завершение задачи'}</h6>
    <p>${completed?'Дополнительное подтверждение не требуется. При ошибке верните задачу в работу.':'Нажмите один раз. Отчёт и подтверждение руководителя не требуются.'}</p>
    <form class="assignment-progress-form" data-assignment-progress-form>
      <input name="progress" type="number" min="0" max="100" value="${completed?100:e(latest?.progress??0)}" aria-label="Прогресс">
      <textarea name="note" rows="2" placeholder="Комментарий, необязательно">${e(latest?.note||'')}</textarea>
      <div class="assignment-actions"><button class="${completed?'secondary-button':'primary-button'}" type="submit" data-next-status="${completed?'open':'completed'}">${completed?'Вернуть в работу':'Выполнено'}</button><span data-assignment-progress-error role="alert"></span></div>
    </form>
  </section>`;
}

function assignmentEvidencePanel(assignment){
  return `<section class="assignment-evidence-panel">
    <h6>Подтверждающие материалы — необязательно</h6>
    <p>Файл можно приложить сейчас или позднее. Его наличие не меняет состояние задачи.</p>
    <form class="work-report-form" data-report-form>
      <select name="documentId"><option value="">Выберите ранее загруженный документ</option>${documentOptions()}</select>
      <label class="field"><span>Новый файл</span><input name="file" type="file" accept=".pdf,.docx,.odt,.txt,.md,.png,.jpg,.jpeg,.tif,.tiff"></label>
      <textarea name="note" rows="2" placeholder="Комментарий, необязательно"></textarea>
      <p class="standalone-upload-state hidden" data-assignment-upload-state></p>
      <div class="assignment-actions"><button class="secondary-button" type="submit">Приложить материал</button><span data-assignment-material-error role="alert"></span></div>
    </form>
    ${assignmentHistory(assignment)}
  </section>`;
}

async function showDirective(id,options={}){
  const directive=await workApi(`/api/directives/${encodeURIComponent(id)}`);
  const results=q('#work-results');
  results.innerHTML=`<section class="work-details" data-directive-id="${e(id)}">
    <div class="work-details-header"><div><span>Распоряжение</span><h3>${e(directive.title)}</h3><p>${e(directive.number||'Без номера')} · ${formatDate(directive.issued_on)}</p></div><button class="secondary-button" type="button" data-directive-add-assignment="${e(id)}">Добавить поручение</button></div>
    <p>${e(directive.summary||'')}</p>
    <div class="assignment-list">${(directive.assignments||[]).map((assignment)=>`<article class="assignment-card" data-assignment-id="${e(assignment.id)}" data-directive-id="${e(id)}">
      <header><h5>${e(assignment.responsible_person_name||'Без исполнителя')} · ${e(roleLabel(assignment.role))}</h5><span class="status-badge">${e(statusLabel(assignment.status))}</span></header>
      <p>${e(assignment.instruction||'')}</p><p><strong>Срок:</strong> ${formatDate(assignment.due_date)}</p>
      ${options.assignmentId===assignment.id&&options.message?`<p class="assignment-notice">${e(options.message)}</p>`:''}
      ${assignmentProgressPanel(assignment)}
      ${assignmentEvidencePanel(assignment)}
    </article>`).join('')||'<div class="empty-state">Поручений пока нет.</div>'}</div>
  </section>`;
}

async function showPeriodic(id){
  const task=await workApi(`/api/periodic-tasks/${encodeURIComponent(id)}`);
  const results=q('#work-results');
  results.innerHTML=`<section class="work-details"><div class="work-details-header"><div><span>Регулярная задача</span><h3>${e(task.title)}</h3><p>${e(task.direction||'')} · ${e(statusLabel(task.status))}</p></div><button class="secondary-button" type="button" data-periodic-edit="${e(id)}">Редактировать</button></div><p>${e(task.description||'')}</p><p><strong>Период:</strong> ${e(task.period_kind)} · ${formatDate(task.period_start)} — ${formatDate(task.period_end)}</p><p><strong>Исполнитель:</strong> ${e(task.owner_person_name||'Не назначен')}</p><p><strong>Контролирующий:</strong> ${e(task.manager_person_name||'Не назначен')}</p><p><strong>Ожидаемый результат:</strong> ${e(task.expected_result||'—')}</p></section>`;
}

async function loadWork(){
  ensureWorkPanel();
  const form=q('#work-filter-form');
  if(!form) return;
  const params=new URLSearchParams(new FormData(form));
  qa('[name]',form).forEach((field)=>{if(!field.value) params.delete(field.name);});
  workState.status=form.elements.status?.value||'';
  params.delete('status');
  const query=params.toString();
  const [data,periodic]=await Promise.all([workApi(`/api/work/search${query?`?${query}`:''}`),workApi(`/api/periodic-tasks${query?`?${query}`:''}`)]);
  let items=[...(data.items||[]),...(periodic.items||[]).map((item)=>({...item,periodicTask:item}))];
  if(workState.status==='open') items=items.filter((item)=>isWorkingStatus(itemStatus(item)));
  if(workState.status==='completed') items=items.filter((item)=>itemStatus(item)==='completed');
  if(workState.status==='cancelled') items=items.filter((item)=>itemStatus(item)==='cancelled');
  renderWork({items});
}

async function refreshLookups(){
  ensureWorkPanel();
  const me=await workApi('/api/me').catch(()=>({}));
  workState.currentPersonId=me.person?.id||me.account?.person_id||null;
  await Promise.all([loadPeople(),loadDocuments()]);
  await loadWork();
}

function assignmentFileKey(assignmentId,file){return encodeURIComponent(`assignment-evidence:${assignmentId}:${file.name}:${file.size}:${file.lastModified}`);}
async function uploadAssignmentMaterial(assignmentId,file){
  return workApi('/api/documents',{method:'POST',headers:{'content-type':file.type||'application/octet-stream','x-file-name':encodeURIComponent(file.name),'x-document-type':'report','idempotency-key':assignmentFileKey(assignmentId,file)},body:file});
}

document.addEventListener('submit',async(event)=>{
  const filter=event.target.closest('#work-filter-form');
  if(filter){event.preventDefault();await loadWork();return;}

  const progressForm=event.target.closest('[data-assignment-progress-form]');
  if(progressForm){
    event.preventDefault();
    const article=progressForm.closest('[data-assignment-id]');
    const button=q('button[type="submit"]',progressForm);
    const error=q('[data-assignment-progress-error]',progressForm);
    if(error) error.textContent='';
    if(button) button.disabled=true;
    try{
      const formData=new FormData(progressForm);
      const nextStatus=button.dataset.nextStatus;
      const progress=nextStatus==='completed'?100:Math.max(0,Math.min(99,Number(formData.get('progress')||0)));
      await workApi(`/api/assignments/${encodeURIComponent(article.dataset.assignmentId)}/progress`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actorPersonId:workState.currentPersonId,status:nextStatus,progress,note:String(formData.get('note')||'').trim()||null})});
      await showDirective(article.dataset.directiveId,{assignmentId:article.dataset.assignmentId,message:nextStatus==='completed'?'Задача выполнена. Подтверждение не требуется.':'Задача возвращена в работу.'});
      await loadWork();
    }catch(requestError){if(error) error.textContent=requestError.message;if(button) button.disabled=false;}
    return;
  }

  const materialForm=event.target.closest('[data-report-form]');
  if(materialForm){
    event.preventDefault();
    const article=materialForm.closest('[data-assignment-id]');
    const button=q('button[type="submit"]',materialForm);
    const error=q('[data-assignment-material-error]',materialForm);
    const uploadState=q('[data-assignment-upload-state]',materialForm);
    if(error) error.textContent='';
    if(button) button.disabled=true;
    try{
      const formData=new FormData(materialForm);
      const file=formData.get('file');
      let documentId=materialForm.dataset.uploadedDocumentId||String(formData.get('documentId')||'');
      if(!documentId&&file instanceof File&&file.size>0){
        const uploaded=await uploadAssignmentMaterial(article.dataset.assignmentId,file);
        documentId=uploaded.documentId||uploaded.id||uploaded.document?.id;
        if(!documentId) throw new Error('Файл сохранён, но сервер не вернул идентификатор документа.');
        materialForm.dataset.uploadedDocumentId=documentId;
        if(uploadState){uploadState.textContent='Файл сохранён. При повторе он не будет загружен второй раз.';uploadState.classList.remove('hidden');}
      }
      if(!documentId) throw new Error('Выберите документ или приложите новый файл.');
      await workApi(`/api/assignments/${encodeURIComponent(article.dataset.assignmentId)}/report`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({documentId,note:String(formData.get('note')||'').trim()||null})});
      await showDirective(article.dataset.directiveId,{assignmentId:article.dataset.assignmentId,message:'Материал приложен. Состояние задачи не изменилось.'});
      await loadWork();
    }catch(requestError){
      if(error) error.textContent=requestError.message;
      if(materialForm.dataset.uploadedDocumentId&&uploadState){uploadState.textContent='Файл уже сохранён. Исправьте ошибку и повторите только привязку.';uploadState.classList.remove('hidden');}
      if(button) button.disabled=false;
    }
  }
});

document.addEventListener('click',async(event)=>{
  const card=event.target.closest('[data-work-item]');
  if(card){if(card.dataset.kind==='directive') await showDirective(card.dataset.workItem);else if(card.dataset.kind==='periodic') await showPeriodic(card.dataset.workItem);return;}
  const delegate=event.target.closest('[data-directive-add-assignment]');
  if(delegate&&typeof window.showDelegationForm==='function'){window.showDelegationForm(delegate.dataset.directiveAddAssignment);return;}
  const periodicEdit=event.target.closest('[data-periodic-edit]');
  if(periodicEdit&&typeof window.showPeriodicTaskForm==='function') window.showPeriodicTaskForm(periodicEdit.dataset.periodicEdit);
});

document.addEventListener('change',(event)=>{if(event.target.closest('#work-filter-form')) loadWork().catch(()=>{});});
window.loadWork=loadWork;
window.renderWork=renderWork;
window.refreshWorkLookups=refreshLookups;
window.workState=workState;
window.workApi=workApi;
ensureWorkPanel();
refreshLookups().catch(()=>{});
