import { createHash } from 'node:crypto';
import { newId } from '../../core/src/ids.mjs';
import { extractDepartmentProtocol } from './extractor.mjs';
import { matchingRecognitionProfiles } from './recognition-profiles.mjs';
import { hasRelocatedAgendaSource } from './meeting-transfer-origin.mjs';
import { syncMeetingSearch } from './meeting-core.mjs';

const meetingFields={protocolNumber:'protocol_number',meetingDate:'meeting_date',chairperson:'chairperson_raw',secretary:'secretary_raw',attendees:'attendees_raw'};
const agendaFields={title:'title',heardText:'heard_text',discussedText:'discussed_text',decisionText:'decision_text'};
const decisionFields={decisionText:'text',responsibleRaw:'responsible_raw',dueDate:'due_date'};
const parse=(value,fallback={}) => {try{return JSON.parse(value);}catch{return fallback;}};
const same=(a,b) => String(a ?? '').replace(/\s+/gu,' ').trim() === String(b ?? '').replace(/\s+/gu,' ').trim();
function touched(database,row,field,column) {
  if ((parse(row.evidence_json).manualCorrections || []).some((change) => change.fields?.some((key) => [field,column].includes(key)))) return true;
  // Legacy editors retain only a bounded inline history; the append-only audit remains authoritative.
  const audits=database.all(`SELECT details_json FROM audit_log WHERE subject_id IN (?,?)
    AND action IN ('meeting.updated','meeting.metadata.corrected','meeting.agenda.updated')`,row.id,row.agenda_item_id || row.id);
  return audits.some((audit) => {const data=parse(audit.details_json);return [...(data.touchedFields || []),...(data.fields || [])].some((key) => [field,column].includes(key));});
}
function ownSource(row,versionId) {
  const sources=parse(row.evidence_json).sources || [];
  return !sources.some((source) => source.documentVersionId && source.documentVersionId !== versionId)
    && (row.source_document_version_id === versionId || row.source_id?.startsWith(`${versionId}:`) || sources.some((source) => source.documentVersionId === versionId));
}
function validDate(value) {
  if (!/^20\d{2}-\d{2}-\d{2}$/u.test(String(value || ''))) return false;
  const date=new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === value;
}
function addReview(database,workspaceId,versionId,code,title,context,now) {
  const row=database.get(`SELECT id FROM review_items WHERE workspace_id=? AND source_kind='document_version'
    AND source_id=? AND issue_code=? AND status='open'`,workspaceId,versionId,code);
  if (row) return;
  database.run(`INSERT INTO review_items(id,workspace_id,source_kind,source_id,issue_code,title,explanation,
    proposed_action,severity,status,context_json,created_at) VALUES(?,?,'document_version',?,?,?,?,?,'warning','open',?,?)`,
  newId('review'),workspaceId,versionId,code,title,context.explanation || 'Текст сохранён, но структуру или значение нужно проверить.',
  'Сравните с исходником и исправьте указанное поле. Остальные данные уже доступны.',JSON.stringify(context),now);
}
function resolve(database,id,runId,now) {
  database.run("UPDATE review_items SET status='resolved',resolved_at=?,resolution_json=? WHERE id=? AND status='open'",
    now,JSON.stringify({kind:'protocol_recognition',extractionRunId:runId}),id);
}
function updateOwned(database,table,row,previous,incoming,fields,versionId,runId,now) {
  if (!ownSource(row,versionId)) return;
  const changes=[];
  for (const [field,column] of Object.entries(fields)) {
    if (touched(database,row,field,column)) continue;
    const value=incoming[field] ?? null;
    const invalidDate=field === 'meetingDate' && incoming.meetingDateIssue;
    const ambiguousDue=field === 'dueDate' && incoming.dueDateAmbiguous;
    if ((!value && !invalidDate && !ambiguousDue) || same(row[column],value)) continue;
    if (row[column] && (!previous || !same(row[column],previous[field]))) continue;
    changes.push({field,before:row[column] ?? null,after:value,locator:incoming.evidence || null});
    database.run(`UPDATE ${table} SET ${column}=? WHERE id=?`,value,row.id);
  }
  if (!changes.length) return;
  const evidence=parse(row.evidence_json);
  const history=[...(evidence.parserCorrections || []),{at:now,documentVersionId:versionId,extractionRunId:runId,changes}];
  database.run(`UPDATE ${table} SET evidence_json=? WHERE id=?`,JSON.stringify({...evidence,parserCorrections:history}),row.id);
}
function calendar(database,workspaceId,kind,row,title,date,description,now) {
  const old=database.get('SELECT id FROM calendar_items WHERE workspace_id=? AND source_kind=? AND source_id=?',workspaceId,kind,row.id);
  if (!validDate(date)) {
    if (old) database.run('DELETE FROM calendar_items WHERE workspace_id=? AND source_kind=? AND source_id=?',workspaceId,kind,row.id);
    return;
  }
  if (old) {
    database.run('UPDATE calendar_items SET title=?,starts_at=?,description=?,updated_at=? WHERE id=?',title,date,description,now,old.id);
    return;
  }
  database.run(`INSERT INTO calendar_items(id,workspace_id,source_kind,source_id,title,starts_at,ends_at,all_day,
    category,importance,status,description,item_kind,reminder_minutes,created_at,updated_at)
    VALUES(?,?,?,?,?,?,NULL,1,'organizational',?,?,?,?,?,?,?)`,newId('cal'),workspaceId,kind,row.id,title,date,
  kind === 'decision' ? 'high' : 'normal',kind === 'decision' ? (row.status === 'completed' ? 'completed' : 'open') : 'proposed',
  description,kind === 'decision' ? 'task' : 'event',kind === 'decision' ? 1440 : null,now,now);
}
function insertQuestion(database,workspaceId,meeting,version,item,title,now) {
  const id=newId('agenda');const number=Number(database.get('SELECT MAX(item_no) AS n FROM agenda_items WHERE meeting_id=?',meeting.id)?.n || 0)+1;
  const evidence={...item.evidence,sources:[{documentVersionId:version,documentTitle:title,relation:'agenda_source',locator:item.evidence}]};
  database.run(`INSERT INTO agenda_items(id,meeting_id,item_no,title,heard_text,discussed_text,decision_text,evidence_json,
    created_at,source_kind,source_id,source_label,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'document_agenda',?,?,?)`,
  id,meeting.id,number,item.title,item.heardText,item.discussedText,item.decisionText,JSON.stringify(evidence),now,`${version}:${item.itemNo}`,title,now);
  return database.get('SELECT * FROM agenda_items WHERE id=?',id);
}
function insertDecision(database,workspaceId,versionId,agenda,item,now) {
  if (!item.decisionText || touched(database,agenda,'decisionText','decision_text')) return;
  database.run(`INSERT INTO decisions(id,agenda_item_id,text,responsible_raw,due_date,status,evidence_json,created_at)
    VALUES(?,?,?,?,?,'proposed',?,?)`,newId('decision'),agenda.id,item.decisionText,item.responsibleRaw,item.dueDate,agenda.evidence_json,now);
  const decision=database.get('SELECT * FROM decisions WHERE agenda_item_id=?',agenda.id);
  if (decision.responsible_raw) addReview(database,workspaceId,versionId,`responsible_person_unresolved_${decision.id}`,
    'Нужно сопоставить ответственного',{decisionId:decision.id,responsibleRaw:decision.responsible_raw},now);
}
function deduplicateDocumentSearch(database,workspaceId,versionId) {
  const rows=database.all(`SELECT * FROM search_fragments WHERE workspace_id=? AND document_version_id=? AND source_kind='document'
    ORDER BY created_at,id`,workspaceId,versionId);const seen=new Set();
  for (const row of rows) {
    const key=JSON.stringify([row.source_id,row.title,row.content,row.locator_json]);
    if (!seen.has(key)) {seen.add(key);continue;}
    database.run('DELETE FROM search_fts WHERE fragment_id=?',row.id);
    database.run('DELETE FROM search_fragments WHERE id=?',row.id);
  }
}

// Called after the core document processor and scalar-profile extension, also on job retries.
export function finalizeProtocolRecognition(database,{documentId,versionId}) {
  const version=database.get(`SELECT dv.*,d.workspace_id,d.title FROM document_versions dv JOIN documents d ON d.id=dv.document_id
    WHERE dv.id=? AND d.id=?`,versionId,documentId);
  if (!version || version.processing_status === 'failed') return {applied:false};
  const run=database.get(`SELECT * FROM extraction_runs WHERE document_version_id=? AND result_json IS NOT NULL
    ORDER BY started_at DESC,rowid DESC LIMIT 1`,versionId);
  const result=parse(run?.result_json);const base=result.protocol;
  if (!run || !base?.id || result.protocolRecognition?.completed) return {applied:false};
  const meeting=database.get('SELECT * FROM meetings WHERE workspace_id=? AND id=?',version.workspace_id,base.id);
  if (!meeting) return {applied:false};
  const previousRun=database.all(`SELECT id,result_json FROM extraction_runs WHERE document_version_id=? AND id<>?
    AND status IN ('completed','needs_review') AND result_json IS NOT NULL ORDER BY completed_at DESC,started_at DESC,id DESC`,versionId,run.id)
    .find((row) => parse(row.result_json).protocol);
  const previous=previousRun ? parse(previousRun.result_json).protocol : base;
  const profile=matchingRecognitionProfiles(database,version.workspace_id,version.extracted_text || '',version.original_name);
  const parsed=profile.profiles.length ? extractDepartmentProtocol(version.extracted_text || '',{aliases:profile.aliases}) : {...base};
  // Scalar profiles are independent of section aliases. Keep their valid candidates when the base field is empty.
  for (const field of Object.keys(meetingFields)) if (!parsed[field] && base[field]
    && (field !== 'meetingDate' || (!parsed.meetingDateIssue && validDate(base[field])))) parsed[field]=base[field];
  const candidate={...base,...parsed,id:meeting.id,materialization:base.materialization,matchedBy:base.matchedBy,importYear:base.importYear};
  const now=new Date().toISOString();const activeCodes=new Set();
  database.transaction(() => {
    updateOwned(database,'meetings',meeting,previous,candidate,meetingFields,versionId,run.id,now);
    const questionMap=new Map();
    for (const item of candidate.agendaItems || []) {
      if (hasRelocatedAgendaSource(database,version.workspace_id,meeting.id,versionId,item)) continue;
      let row=database.get(`SELECT ai.* FROM agenda_items ai JOIN meetings m ON m.id=ai.meeting_id
        WHERE m.workspace_id=? AND ai.source_kind='document_agenda' AND ai.source_id=?`,version.workspace_id,`${versionId}:${item.itemNo}`);
      if (row && row.meeting_id !== meeting.id) continue;
      const old=previous?.agendaItems?.find((entry) => Number(entry.itemNo) === Number(item.itemNo));
      if (!row) {
        // A previously materialized question may have been removed or transferred deliberately.
        if (previousRun && old) continue;
        const matches=database.all('SELECT * FROM agenda_items WHERE meeting_id=?',meeting.id).filter((entry) => same(entry.title,item.title));
        if (matches.length === 1) row=matches[0];
        else if (!matches.length) row=insertQuestion(database,version.workspace_id,meeting,versionId,item,version.title,now);
        else continue;
      }
      questionMap.set(item.itemNo,row.id);
      const mappingSafe=!old || same(old.title,item.title) || same(row.title,item.title) || touched(database,row,'title','title');
      if (mappingSafe) {
        const incoming={...item,dueDateAmbiguous:(candidate.diagnostics || []).some((issue) => issue.itemNo === item.itemNo && issue.code === 'question_due_ambiguous')};
        updateOwned(database,'agenda_items',row,old,incoming,agendaFields,versionId,run.id,now);
        const decisions=database.all('SELECT * FROM decisions WHERE agenda_item_id=? ORDER BY created_at,id',row.id);
        if (!decisions.length) insertDecision(database,version.workspace_id,versionId,row,incoming,now);
        else if (decisions.length === 1) updateOwned(database,'decisions',decisions[0],old,incoming,decisionFields,versionId,run.id,now);
      } else {
        const code=`protocol_recognition_mapping_${row.id}`;activeCodes.add(code);
        addReview(database,version.workspace_id,versionId,code,'Нужно сопоставить вопрос после повторного разбора',
          {meetingId:meeting.id,agendaId:row.id,recognitionField:'title',incoming:item.title,existing:row.title,evidence:item.evidence},now);
      }
      row=database.get('SELECT * FROM agenda_items WHERE id=?',row.id);
      for (const decision of database.all('SELECT * FROM decisions WHERE agenda_item_id=?',row.id)) {
        calendar(database,version.workspace_id,'decision',decision,`Срок: ${row.title}`,decision.due_date,decision.text,now);
      }
    }
    for (const issue of candidate.diagnostics || []) {
      const id=questionMap.get(issue.itemNo);if (!id) continue;
      const agenda=database.get('SELECT * FROM agenda_items WHERE id=?',id);
      const decision=database.get('SELECT * FROM decisions WHERE agenda_item_id=? ORDER BY created_at,id LIMIT 1',id);
      const field={question_title_missing:'title',question_body_missing:'heardText',question_decision_missing:'decisionText',question_due_ambiguous:'dueDate',duplicate_question:'heardText'}[issue.code] || 'title';
      if (field === 'decisionText' && agenda.decision_text) continue;
      if (field === 'heardText' && issue.code === 'question_body_missing' && (agenda.heard_text || agenda.discussed_text || agenda.decision_text)) continue;
      if (touched(database,field === 'dueDate' && decision ? decision : agenda,field,agendaFields[field] || decisionFields[field])) continue;
      const code=`protocol_recognition_${issue.code}_${id}`;activeCodes.add(code);
      addReview(database,version.workspace_id,versionId,code,issue.message,{meetingId:meeting.id,agendaId:id,decisionId:decision?.id || null,recognitionField:field,line:issue.line,evidence:agenda.evidence_json},now);
    }
    if (profile.conflicts.length) {
      activeCodes.add('protocol_recognition_profile_conflict');
      addReview(database,version.workspace_id,versionId,'protocol_recognition_profile_conflict','Несколько форматов по-разному определяют раздел',
        {meetingId:meeting.id,explanation:`Уточните форматы для обозначений: ${profile.conflicts.join(', ')}. Базовый разбор сохранён.`,profiles:profile.profiles},now);
    }
    const current=database.get('SELECT * FROM meetings WHERE id=?',meeting.id);
    calendar(database,version.workspace_id,'meeting',current,current.protocol_number ? `Заседание кафедры · протокол №${current.protocol_number}` : 'Заседание кафедры',current.meeting_date,current.title,now);
    const reviews=database.all("SELECT * FROM review_items WHERE workspace_id=? AND source_kind='document_version' AND source_id=? AND status='open'",version.workspace_id,versionId);
    for (const review of reviews) {
      const reviewContext=parse(review.context_json);
      const reviewAgenda=reviewContext.agendaId ? database.get('SELECT meeting_id FROM agenda_items WHERE id=?',reviewContext.agendaId) : null;
      const relocated=reviewAgenda && reviewAgenda.meeting_id !== meeting.id;
      if (review.issue_code.startsWith('protocol_recognition_') && !activeCodes.has(review.issue_code) && !relocated) resolve(database,review.id,run.id,now);
      if (review.issue_code === 'protocol_number_missing' && current.protocol_number) resolve(database,review.id,run.id,now);
      if (review.issue_code === 'meeting_date_missing' && validDate(current.meeting_date)) resolve(database,review.id,run.id,now);
      if (review.issue_code === 'protocol_year_mismatch' && current.meeting_date?.startsWith(`${base.importYear}-`)) resolve(database,review.id,run.id,now);
    }
    database.run('UPDATE meetings SET updated_at=? WHERE id=?',now,meeting.id);
    deduplicateDocumentSearch(database,version.workspace_id,versionId);
    syncMeetingSearch(database,version.workspace_id,meeting.id);
    const count=Number(database.get("SELECT COUNT(*) AS n FROM review_items WHERE workspace_id=? AND source_kind='document_version' AND source_id=? AND status='open'",version.workspace_id,versionId).n);
    candidate.reviewCount=count;
    database.run("UPDATE extraction_runs SET result_json=?,status=?,extractor_version='2' WHERE id=?",JSON.stringify({...result,protocolBase:base,protocol:candidate,
      protocolRecognition:{completed:true,parserVersion:2,profiles:profile.profiles,documentVersionId:versionId,previousExtractionId:previousRun?.id || null,
        sourceText:version.extracted_text || '',sourceTextSha256:createHash('sha256').update(version.extracted_text || '').digest('hex')}}),count ? 'needs_review' : 'completed',run.id);
    database.run('UPDATE document_versions SET processing_status=? WHERE id=?',count ? 'needs_review' : 'processed',versionId);
    database.run('UPDATE documents SET status=?,updated_at=? WHERE id=? AND current_version_id=?',count ? 'needs_review' : 'processed',now,documentId,versionId);
  });
  return {applied:true,meetingId:meeting.id,extractionRunId:run.id};
}
