import { meetingApi, meetingsState, escMeeting as esc } from './meetings-state.js';

let scope = '';
let filter = 'all';
let busy = false;
let notice = '';
let currentItems = [];
const selected = new Set();
const json = (method, body) => ({ method, headers:{'content-type':'application/json'}, body:JSON.stringify(body) });
const toolsUrl = (id, text=false) => `/api/protocol-imports/tools?documentId=${encodeURIComponent(id)}${text ? '&text=1' : ''}`;
const visible = (item) => filter === 'all' || (filter === 'attention' ? ['needs_review','failed'].includes(item.state) : item.state === filter);
const readyToEdit = (item) => item.meeting_id && !['processing','uploading','failed'].includes(item.state);

export function ensureProtocolToolsStyle() {
  if (document.querySelector('#protocol-batch-style')) return;
  const link=document.createElement('link');link.id='protocol-batch-style';link.rel='stylesheet';link.href='/protocol-batch.css';document.head.append(link);
}
export function protocolDialog(title, body) {
  ensureProtocolToolsStyle();
  const previousFocus=document.activeElement;
  const dialog=document.createElement('dialog');dialog.className='protocol-tools-dialog';dialog.setAttribute('aria-label',title);
  dialog.innerHTML=`<h2>${esc(title)}</h2>${body}`;document.body.append(dialog);
  dialog.addEventListener('close',() => {dialog.remove();if (previousFocus?.isConnected) previousFocus.focus();});
  dialog.addEventListener('click',(event) => {if (event.target.closest('[data-close-tools]')) dialog.close();});
  return dialog;
}

export function enhanceProtocolBatch(items, {refresh, render}) {
  const root=document.querySelector('#protocol-import-summary');if (!root || !items.length) return;
  ensureProtocolToolsStyle();currentItems=items;
  const nextScope=`${meetingsState.protocolImports.workspaceId || ''}:${meetingsState.selectedYear}`;
  if (scope !== nextScope) {scope=nextScope;selected.clear();filter='all';notice='';}
  const chosen=() => currentItems.filter((item) => selected.has(item.document_id));
  const toolbar=document.createElement('div');toolbar.className='protocol-batch-bar';
  toolbar.innerHTML=`<label>Показать <select aria-label="Фильтр протоколов">${[['all','Все файлы'],['attention','Требуют внимания'],['ready','Готовые'],['failed','Ошибки']].map(([value,label])=>`<option value="${value}" ${filter===value?'selected':''}>${label}</option>`).join('')}</select></label>
    <button type="button" data-batch="select">Выбрать видимые</button><button type="button" data-batch="clear">Снять выбор</button>
    <span data-selected-count></span><button type="button" data-batch="edit">Править реквизиты</button>
    <button type="button" data-batch="retry">Повторить выбранные</button><button type="button" data-batch="format">Настроить распознавание</button>
    <div class="protocol-batch-notice" role="status">${esc(busy ? 'Выполняется…' : notice)}</div>`;
  root.querySelector('.protocol-import-list')?.before(toolbar);
  function controls() {
    const rows=chosen();toolbar.querySelector('[data-selected-count]').textContent=`Выбрано: ${rows.length}`;
    for (const button of toolbar.querySelectorAll('[data-batch]')) button.disabled=busy || (!rows.length && !['select','clear'].includes(button.dataset.batch));
    toolbar.querySelector('[data-batch=edit]').disabled=busy || !rows.some(readyToEdit);
    toolbar.querySelector('[data-batch=format]').disabled=busy || !rows.some(readyToEdit);
  }
  root.querySelectorAll('[data-protocol-import-item]').forEach((row,index)=>{
    const item=items[index];row.hidden=!visible(item);
    if (!item.document_id) return;
    const label=document.createElement('label');label.className='protocol-select';
    label.innerHTML=`<input type="checkbox" aria-label="Выбрать ${esc(item.original_name || item.title)}" ${selected.has(item.document_id)?'checked':''} ${busy?'disabled':''}> Выбрать`;
    label.querySelector('input').addEventListener('change',(event)=>{event.target.checked?selected.add(item.document_id):selected.delete(item.document_id);controls();});
    row.querySelector('.protocol-import-state')?.prepend(label);
  });
  toolbar.querySelector('select').addEventListener('change',(event)=>{filter=event.target.value;render();});
  toolbar.addEventListener('click',async(event)=>{
    const button=event.target.closest('[data-batch]');if (!button || button.disabled || busy) return;
    const action=button.dataset.batch;
    try {
      if (action==='select') {for (const item of currentItems.filter(visible)) if (item.document_id) selected.add(item.document_id);render();return;}
      if (action==='clear') {selected.clear();render();return;}
      if (action==='edit') {await editHeaders(chosen().filter(readyToEdit),refresh);return;}
      if (action==='format') {const module=await import('./protocol-format-editor.js');await module.openProtocolFormat(chosen().find(readyToEdit));return;}
      if (action!=='retry') return;
      const batch=chosen().filter((item)=>!['processing','uploading'].includes(item.state));const originalScope=scope;
      busy=true;render();let ok=0;const errors=[];
      for (const item of batch) {
        try {await meetingApi(`/api/documents/${encodeURIComponent(item.document_id)}/reprocess`,{method:'POST'});ok+=1;}
        catch(error) {errors.push(`${item.original_name}: ${error.message}`);}
      }
      if (scope===originalScope) notice=`Поставлено на распознавание: ${ok}. Ошибок: ${errors.length}.${errors.length?' '+errors.join(' · '):''}`;
      busy=false;await refresh();
    } catch(error) {notice=error.message;busy=false;render();}
  });
  controls();
}

async function editHeaders(items, refresh) {
  if (!items.length) return;
  const dialog=protocolDialog('Массовая правка протоколов',`<p>Сохраняются только изменённые поля. Ошибка одной строки не отменяет остальные.</p>
    <form novalidate><div data-edit-rows></div><div class="protocol-tools-actions"><button type="submit" class="primary-button">Сохранить правки</button><button type="button" data-close-tools>Закрыть</button></div><div role="status" aria-live="polite"></div></form>`);
  const form=dialog.querySelector('form');const rows=[];let saving=false;form.onsubmit=(event)=>event.preventDefault();form.querySelector('[type=submit]').disabled=true;
  const fieldDefs=[['protocolNumber','Номер','text'],['meetingDate','Дата заседания','date'],['chairperson','Председатель','text'],['secretary','Секретарь','text'],['attendees','Присутствовали','textarea']];
  for (const item of items) {
    const section=document.createElement('section');section.className='protocol-bulk-row';section.dataset.documentId=item.document_id;
    section.innerHTML=`<h3>${esc(item.original_name)}</h3><p data-source-info>Загрузка реквизитов…</p><fieldset class="protocol-tools-fields"></fieldset><div role="status" aria-live="polite"></div><div role="alert"></div><button type="button" data-reload-row hidden>Обновить строку</button>`;
    form.querySelector('[data-edit-rows]').append(section);rows.push({item,section,data:null});
  }
  dialog.showModal();
  async function load(row, preserve=false) {
    const inputs=[...row.section.querySelectorAll('[data-field]')];
    const draft=Object.fromEntries(inputs.filter((input)=>input.value!==(row.data?.fields[input.dataset.field] || '')).map((input)=>[input.dataset.field,input.value]));
    const fresh=await meetingApi(toolsUrl(row.item.document_id));row.data=fresh;
    row.section.querySelector('[data-source-info]').innerHTML=`<a href="${esc(fresh.originalUrl)}" target="_blank" rel="noopener">Исходный файл</a>${fresh.dateSource?` · Дата в источнике: ${esc(fresh.dateSource)}`:''}<details><summary>Текст шапки</summary><pre class="protocol-tools-source">${esc(fresh.sourceExcerpt)}</pre></details>`;
    row.section.querySelector('fieldset').innerHTML=fieldDefs.map(([key,label,type])=>`<label>${label}${type==='textarea'?`<textarea rows="2" data-field="${key}">${esc(preserve&&Object.hasOwn(draft,key)?draft[key]:fresh.fields[key])}</textarea>`:`<input type="${type}" data-field="${key}" value="${esc(preserve&&Object.hasOwn(draft,key)?draft[key]:fresh.fields[key])}">`}</label>`).join('');
    row.section.querySelector('[role=alert]').textContent='';
    row.section.querySelector('[role=status]').textContent=preserve?`Строка обновлена. Ваши правки оставлены в полях. Сохранено в системе: ${fieldDefs.map(([key,label])=>`${label}: ${fresh.fields[key] || '—'}`).join('; ')}`:'';
    row.section.querySelector('[data-reload-row]').hidden=true;
  }
  for (const row of rows) {
    try {await load(row);} catch(error) {row.section.querySelector('[role=alert]').textContent=error.message;row.section.querySelector('[data-reload-row]').hidden=false;}
    row.section.querySelector('[data-reload-row]').onclick=async()=>{
      if(saving) return;
      try {await load(row,true);} catch(error) {row.section.querySelector('[role=alert]').textContent=error.message;}
    };
  }
  form.querySelector('[type=submit]').disabled=false;
  form.onsubmit=async(event)=>{
    event.preventDefault();if(saving)return;saving=true;
    const submit=form.querySelector('[type=submit]');submit.disabled=true;let ok=0;let failed=0;
    for(const row of rows) row.section.querySelector('fieldset').disabled=true;
    try {
      for(const row of rows) {
        if(!row.data){failed+=1;continue;}
        const changes=Object.fromEntries([...row.section.querySelectorAll('[data-field]')].filter((input)=>input.value!==(row.data.fields[input.dataset.field] || '')).map((input)=>[input.dataset.field,input.value]));
        if(!Object.keys(changes).length)continue;
        try {
          row.data=await meetingApi(`/api/protocol-imports/${encodeURIComponent(row.item.document_id)}/correction`,json('PATCH',{documentVersionId:row.data.documentVersionId,expectedUpdatedAt:row.data.updatedAt,fields:changes}));
          for (const input of row.section.querySelectorAll('[data-field]')) input.value=row.data.fields[input.dataset.field] || '';
          row.section.querySelector('[role=status]').textContent='Сохранено';row.section.querySelector('[role=alert]').textContent='';row.section.querySelector('[data-reload-row]').hidden=true;ok+=1;
        } catch(error) {failed+=1;row.section.querySelector('[role=alert]').textContent=error.message;row.section.querySelector('[data-reload-row]').hidden=error.code!=='protocol_correction_stale';}
      }
      form.querySelector(':scope > [role=status]').textContent=`Сохранено: ${ok}. Ошибок: ${failed}.${failed?' Исправьте отмеченные строки и сохраните ещё раз.':''}`;
      await refresh();
    } catch(error) {form.querySelector(':scope > [role=status]').textContent=`Сохранено: ${ok}. Ошибка обновления списка: ${error.message}`;}
    finally {saving=false;submit.disabled=false;for(const row of rows)row.section.querySelector('fieldset').disabled=false;}
  };
}
