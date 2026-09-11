import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { registerDocument, requestDocumentReprocess } from '../packages/storage/src/documents.mjs';
import { loadConfig } from '../packages/config/src/index.mjs';
import { createApp } from '../apps/api/src/app.mjs';
import { processDocumentJob } from '../apps/worker/src/processor.mjs';
import { applyProtocolProfileForJob } from '../apps/worker/src/protocol-profile-job.mjs';
import { applyProtocolRecognitionForJob } from '../apps/worker/src/protocol-recognition-job.mjs';
import { updateAgendaItem, deleteAgendaItem, createMeeting, transferAgendaItem, getMeeting } from '../packages/protocols/src/meetings.mjs';
import { writeZipArchive } from '../packages/plan-docx/src/archive.mjs';
import { listTemplates, applyMatchingTemplates } from '../packages/templates/src/service.mjs';
const sample=await readFile(new URL('./fixtures/protocol-separate-agenda.txt',import.meta.url),'utf8');
const logger={debug(){},info(){},warn(){},error(){}};
const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');

async function fixture(run) {
  const dir=await mkdtemp(join(tmpdir(),'kafedra-protocol-batch-'));
  const config=loadConfig({KAFEDRA_DATA_DIR:dir,KAFEDRA_AUTH_ENABLED:'false',KAFEDRA_PREVIEW_ENABLED:'false',KAFEDRA_OCR_ENABLED:'false'});
  await Promise.all([mkdir(config.blobDir,{recursive:true}),mkdir(config.tempDir,{recursive:true})]);
  const db=new Database(join(dir,'test.sqlite3'),{migrationsDir:resolve('migrations')});const workspace=ensureDefaultWorkspace(db);
  const server=createApp({database:db,config,logger});server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const api=async(path,body,method='POST')=>{const response=await fetch(base+path,body===undefined?{}:{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  async function process(record,finish=true) {
    const payload={documentId:record.documentId,versionId:record.versionId,requestedType:'protocol',reprocess:Boolean(record.reprocess)};
    const job={kind:'process_document',payload_json:JSON.stringify(payload)};
    await processDocumentJob(db,payload,logger,config);await applyProtocolProfileForJob(db,job,logger);
    if(finish)applyProtocolRecognitionForJob(db,job,logger);
    db.run("UPDATE jobs SET status='completed' WHERE id=?",record.jobId);return job;
  }
  async function ingest(text,name='sample.txt',format='text',finish=true) {
    const file=join(dir,name);
    if(format==='docx') {
      const xml=(value)=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
      const paragraphs=text.split('\n').filter((line)=>!line.includes('|')).map((line)=>`<w:p><w:r><w:t xml:space="preserve">${xml(line)}</w:t></w:r></w:p>`).join('');
      const table=`<w:tbl>${text.split('\n').filter((line)=>line.includes('|')).map((line)=>`<w:tr>${line.split('|').map((cell)=>`<w:tc><w:p><w:r><w:t>${xml(cell.trim())}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
      await writeZipArchive(file,{'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
        'word/document.xml':`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}${table}<w:sectPr/></w:body></w:document>`});
    }else await writeFile(file,text);
    const bytes=await readFile(file);
    const record=registerDocument(db,{workspaceId:workspace.id,title:name,originalName:name,mediaType:format==='docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'text/plain',detectedFormat:format,requestedType:'protocol',idempotencyKey:`protocol-year:2026:${sha(bytes)}`,blob:{sha256:sha(bytes),sizeBytes:bytes.length,storagePath:file}});
    await process(record,finish);return {...record,path:file};
  }
  async function reprocess(record,finish=true) {const requested=requestDocumentReprocess(db,{workspaceId:workspace.id,documentId:record.documentId});return process({...requested,reprocess:true},finish);}
  const tools=async(record)=>(await api(`/api/protocol-imports/tools?documentId=${record.documentId}&text=1`)).body;
  const correct=async(record,fields)=>{const current=await tools(record);return api(`/api/protocol-imports/${record.documentId}/correction`,{documentVersionId:current.documentVersionId,expectedUpdatedAt:current.updatedAt,fields},'PATCH');};
  try {await run({db,workspace,api,ingest,reprocess,tools,correct,dir});}
  finally {server.closeAllConnections();await new Promise((resolve)=>server.close(resolve));db.close();await rm(dir,{recursive:true,force:true});}
}

test('реальный DOCX и TXT: весь документ, подписи в таблице, частичная правка и пагинация',()=>fixture(async({db,workspace,api,ingest,tools,correct})=>{
  const first=await ingest(sample,'sample25.docx','docx');const second=await ingest(sample.replace('№ 25','№ 26'),'sample26.txt');
  const one=(await api('/api/protocol-imports?year=2026&limit=1&offset=0')).body;
  const two=(await api('/api/protocol-imports?year=2026&limit=1&offset=1')).body;
  assert.equal(one.hasMore,true);assert.equal(two.hasMore,false);assert.notEqual(one.items[0].document_id,two.items[0].document_id);
  const view=await tools(first);assert.match(view.dateSource,/00/);assert.equal(view.fields.meetingDate,'');
  let meeting=getMeeting(db,workspace.id,view.meetingId);assert.equal(meeting.agenda.length,3);
  assert.match(meeting.agenda[0].decision_text,/2\) Тематику/);assert.doesNotMatch(meeting.agenda[2].decision_text,/Протокол вел|Образцова/);
  assert.equal((await correct(first,{meetingDate:'2026-07-05',secretary:'Ручная запись'})).status,200);
  assert.equal((await correct(second,{meetingDate:'2026-02-30'})).status,400);
  assert.equal((await tools(first)).fields.secretary,'Ручная запись');assert.equal((await tools(second)).fields.meetingDate,'');
  const stale=await tools(first);await correct(first,{chairperson:'Другой председатель'});
  const conflict=await api(`/api/protocol-imports/${first.documentId}/correction`,{documentVersionId:stale.documentVersionId,expectedUpdatedAt:stale.updatedAt,fields:{secretary:'Устаревшая форма'}},'PATCH');
  assert.equal(conflict.status,409);assert.equal((await tools(first)).fields.secretary,'Ручная запись');
  assert.deepEqual(db.foreignKeyCheck(),[]);assert.equal(db.quickCheck(),true);
}));

test('профиль: readonly preview, идемпотентные версии, новый машинный результат и ручные правки',()=>fixture(async({db,workspace,api,ingest,reprocess,tools,correct})=>{
  const record=await ingest(sample.replaceAll('Решение:','Итоговое заключение:'),'custom.txt');const initial=await tools(record);
  const input={documentId:record.documentId,documentVersionId:record.versionId,name:'Формат кафедры',requiredPhrase:'кафедры',aliases:{decision:['Итоговое заключение']}};
  assert.equal((await api('/api/protocol-imports/recognition',input)).status,200);assert.equal(db.get('SELECT COUNT(*) AS n FROM document_templates').n,0);
  const created=(await api('/api/protocol-imports/recognition',input,'PUT')).body;assert.equal(created.version,1);
  const repeated=(await api('/api/protocol-imports/recognition',input,'PUT')).body;assert.equal(repeated.id,created.id);assert.equal(repeated.duplicateRequest,true);
  assert.equal(listTemplates(db,workspace.id).length,0);
  assert.equal(applyMatchingTemplates(db,{workspaceId:workspace.id,version:{id:record.versionId,original_name:'x'},text:sample}).length,0);
  await correct(record,{meetingDate:'2026-07-05',protocolNumber:'125',secretary:'Ручной секретарь'});
  const question=getMeeting(db,workspace.id,initial.meetingId).agenda[0];
  updateAgendaItem(db,workspace.id,initial.meetingId,question.id,{title:'Ручное название',heardText:'Ручное изложение',decisionText:'Ручное решение'});
  const oldRun=db.get('SELECT * FROM extraction_runs WHERE document_version_id=? ORDER BY started_at DESC,id DESC LIMIT 1',record.versionId);
  const original=await readFile(record.path);await reprocess(record);
  let meeting=getMeeting(db,workspace.id,initial.meetingId);assert.equal(meeting.agenda.length,3);assert.equal(meeting.secretary_raw,'Ручной секретарь');assert.equal(meeting.protocol_number,'125');
  assert.equal(meeting.agenda.find((item)=>item.id===question.id).decision_text,'Ручное решение');
  assert.match(meeting.agenda[2].decision_text,/Рекомендовать/);assert.doesNotMatch(meeting.agenda[2].heard_text,/Итоговое заключение/);
  assert.equal(db.get('SELECT result_json FROM extraction_runs WHERE id=?',oldRun.id).result_json,oldRun.result_json);
  assert.deepEqual(await readFile(record.path),original);assert.equal(db.get('SELECT COUNT(*) AS n FROM document_versions').n,1);
  const counts=()=>({questions:db.get('SELECT COUNT(*) AS n FROM agenda_items').n,decisions:db.get('SELECT COUNT(*) AS n FROM decisions').n,search:db.get('SELECT COUNT(*) AS n FROM search_fragments').n});
  const before=counts();await reprocess(record);assert.deepEqual(counts(),before);
  const next=(await api('/api/protocol-imports/recognition',{...input,profileId:created.id,aliases:{decision:['Итоговое заключение','Заключили']}},'PUT')).body;
  assert.equal(next.version,2);assert.equal(db.get('SELECT status FROM document_templates WHERE id=?',created.id).status,'archived');
  assert.equal((await api('/api/protocol-imports/recognition',{...input,profileId:created.id,name:'Устаревшая правка'},'PUT')).status,409);
}));

test('повтор после переноса и удаления не возвращает вопросы и не закрывает чужую проверку',()=>fixture(async({db,workspace,api,ingest,reprocess,tools})=>{
  const record=await ingest(sample.replaceAll('Решение:','Неизвестный итог:'),'unresolved.txt');const view=await tools(record);
  const source=getMeeting(db,workspace.id,view.meetingId);const target=createMeeting(db,workspace.id,{protocolNumber:'target',meetingDate:'2026-10-01'});
  const moved=source.agenda[0];transferAgendaItem(db,workspace.id,source.id,moved.id,{targetMeetingId:target.id,requestId:'recognition-transfer'});
  deleteAgendaItem(db,workspace.id,source.id,source.agenda[1].id);
  await reprocess(record);
  assert.equal(getMeeting(db,workspace.id,source.id).agenda.length,1);assert.equal(getMeeting(db,workspace.id,target.id).agenda[0].id,moved.id);
  assert.ok(db.get("SELECT id FROM review_items WHERE status='open' AND json_extract(context_json,'$.agendaId')=? AND issue_code LIKE 'protocol_recognition_%'",moved.id));
}));

test('ошибка записи итогового разбора откатывает только его транзакцию и допускает безопасный повтор',()=>fixture(async({db,api,ingest,reprocess,tools})=>{
  const record=await ingest(sample.replaceAll('Решение:','Итоговое заключение:'),'rollback.txt');
  await api('/api/protocol-imports/recognition',{documentId:record.documentId,name:'Формат',requiredPhrase:'кафедры',aliases:{decision:['Итоговое заключение']}},'PUT');
  const job=await reprocess(record,false);const before=db.all('SELECT * FROM agenda_items');const decisions=db.all('SELECT * FROM decisions');
  const original=db.run.bind(db);db.run=(sql,...args)=>{if(sql.startsWith('UPDATE extraction_runs SET result_json='))throw new Error('forced-recognition-failure');return original(sql,...args);};
  assert.throws(()=>applyProtocolRecognitionForJob(db,job,logger),/forced-recognition-failure/);db.run=original;
  assert.deepEqual(db.all('SELECT * FROM agenda_items'),before);assert.deepEqual(db.all('SELECT * FROM decisions'),decisions);
  assert.equal(applyProtocolRecognitionForJob(db,job,logger).applied,true);assert.equal(applyProtocolRecognitionForJob(db,job,logger).applied,false);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM decisions').n,3);
}));

test('валидация форматов не меняет БД; пустой документ не блокирует следующий',()=>fixture(async({db,api,ingest})=>{
  const record=await ingest(sample,'valid.txt');const input={documentId:record.documentId,name:'Формат',requiredPhrase:'кафедры',aliases:{decision:['Заключили']}};
  assert.equal((await api('/api/protocol-imports/recognition',{...input,requiredPhrase:''},'PUT')).status,400);
  assert.equal((await api('/api/protocol-imports/recognition',{...input,aliases:{heard:['Решение']}},'PUT')).status,400);
  assert.equal((await api('/api/protocol-imports/recognition',{...input,documentId:'missing'},'PUT')).status,404);
  assert.equal((await api('/api/protocol-imports/recognition',{...input,requiredPhrase:'несовпадение'},'PUT')).status,400);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM document_templates').n,0);
  await ingest('','empty.txt');await ingest(sample.replace('№ 25','№ 27').replace('«00»','«07»'),'ready.txt');
  const list=(await api('/api/protocol-imports?year=2026')).body;assert.equal(list.summary.total,3);assert.equal(list.summary.ready,1);
}));
