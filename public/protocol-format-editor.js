import { meetingApi, escMeeting as esc } from './meetings-state.js';
import { protocolDialog } from './protocol-batch.js';
const kinds={agenda:'Повестка',heard:'Слушали',discussed:'Выступили / обсудили',decision:'Решение',chairperson:'Председатель',secretary:'Секретарь',attendees:'Присутствовали'};
export async function openProtocolFormat(item) {
  if(!item)return;
  const [profiles,source]=await Promise.all([meetingApi('/api/protocol-imports/recognition'),meetingApi(`/api/protocol-imports/tools?documentId=${encodeURIComponent(item.document_id)}&text=1`)]);
  const dialog=protocolDialog('Формат распознавания протокола',`<p>Добавьте обозначения разделов из ваших документов. Варианты разделяйте точкой с запятой. Тексты решений не заменяются.</p><form>
    <fieldset><label>Формат<select name="profileId"><option value="">Новый формат</option>${profiles.items.map((profile)=>`<option value="${esc(profile.id)}">${esc(profile.name)} · версия ${profile.version}</option>`).join('')}</select></label>
    <div class="protocol-tools-fields"><label>Название<input name="name" maxlength="120" required value="Протоколы кафедры"></label><label>Общая фраза в документах<input name="requiredPhrase" maxlength="160" value="кафедры"></label><label>Часть имени файла (необязательно)<input name="filenameContains" maxlength="120"></label>
    ${Object.entries(kinds).map(([key,label])=>`<label>${label}<input name="marker_${key}" placeholder="Обозначения через ;"></label>`).join('')}</div></fieldset>
    <details><summary>Исходный текст: ${esc(item.original_name)}</summary><pre class="protocol-tools-source">${esc(source.sourceText)}</pre></details>
    <div class="protocol-tools-actions"><button type="submit">Проверить на образце</button><button type="button" class="primary-button" data-save-profile disabled>Сохранить формат</button><button type="button" data-close-tools>Закрыть</button></div>
    <div role="status" aria-live="polite"></div><pre class="protocol-tools-result"></pre></form>`);
  const form=dialog.querySelector('form');const save=dialog.querySelector('[data-save-profile]');const status=dialog.querySelector('[role=status]');const resultView=dialog.querySelector('.protocol-tools-result');
  let checked=null;let sequence=0;let saving=false;
  const payload=()=>({documentId:item.document_id,documentVersionId:source.documentVersionId,profileId:form.elements.profileId.value || null,name:form.elements.name.value,requiredPhrase:form.elements.requiredPhrase.value,filenameContains:form.elements.filenameContains.value,
    aliases:Object.fromEntries(Object.keys(kinds).map((kind)=>[kind,form.elements[`marker_${kind}`].value.split(';').map((value)=>value.trim()).filter(Boolean)]))});
  const invalidate=()=>{checked=null;save.disabled=true;sequence+=1;};form.addEventListener('input',invalidate);
  form.elements.profileId.onchange=()=>{
    const profile=profiles.items.find((candidate)=>candidate.id===form.elements.profileId.value);invalidate();
    form.elements.name.value=profile?.name || 'Протоколы кафедры';form.elements.requiredPhrase.value=profile?.matcher?.requiredPhrases?.join(' ') || 'кафедры';form.elements.filenameContains.value=profile?.matcher?.filenameContains || '';
    for(const kind of Object.keys(kinds))form.elements[`marker_${kind}`].value=(profile?.aliases[kind] || []).join('; ');
    resultView.textContent='';status.textContent='';
  };
  form.onsubmit=async(event)=>{
    event.preventDefault();if(saving)return;invalidate();const token=sequence;const input=payload();status.textContent='Проверяется…';
    try {
      const preview=await meetingApi('/api/protocol-imports/recognition',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
      if(token!==sequence){status.textContent='Форма изменилась. Проверьте образец заново.';return;}
      const result=preview.result;
      resultView.textContent=[`Протокол №${result.protocolNumber || 'не найден'} · ${result.meetingDate || 'дата требует исправления'}`,
        ...result.agendaItems.map((question)=>`${question.itemNo}. ${question.title}\nСлушали: ${question.heardText || '—'}\nОбсудили: ${question.discussedText || '—'}\nРешение: ${question.decisionText || '—'}`),...(result.diagnostics || []).map((issue)=>issue.message)].join('\n\n');
      checked=preview.matched?input:null;save.disabled=!checked;status.textContent=preview.matched?`Найдено вопросов: ${result.agendaItems.length}. Проверьте тексты ниже.`:'Условие не совпадает с образцом. Исправьте общую фразу или имя файла.';
    }catch(error){if(token===sequence)status.textContent=error.message;}
  };
  save.onclick=async()=>{
    if(!checked || save.disabled || saving)return;saving=true;save.disabled=true;form.querySelector('fieldset').disabled=true;
    try {
      const saved=await meetingApi('/api/protocol-imports/recognition',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(checked)});
      checked=null;status.textContent=`Сохранена версия ${saved.version}. Закройте окно и нажмите «Повторить выбранные». Новые подходящие документы распознаются автоматически.`;
      const stored={id:saved.id,name:saved.profile.name,version:saved.version,matcher:saved.profile.matcher,aliases:saved.profile.aliases};profiles.items=profiles.items.filter((profile)=>profile.id!==form.elements.profileId.value);profiles.items.push(stored);
      form.elements.profileId.innerHTML='<option value="">Новый формат</option>'+profiles.items.map((profile)=>`<option value="${esc(profile.id)}">${esc(profile.name)} · версия ${profile.version}</option>`).join('');form.elements.profileId.value=stored.id;
    }catch(error){status.textContent=error.message;save.disabled=false;}
    finally{saving=false;form.querySelector('fieldset').disabled=false;}
  };
  dialog.showModal();
}
