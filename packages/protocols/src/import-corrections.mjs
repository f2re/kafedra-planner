import { AppError } from '../../core/src/errors.mjs';
import { newId } from '../../core/src/ids.mjs';
import { updateMeeting, syncMeetingSearch } from './meeting-core.mjs';
import { resolveMeetingReviews } from './meeting-reviews.mjs';
import { writeAudit } from './meeting-common.mjs';

const columns={protocolNumber:'protocol_number',meetingDate:'meeting_date',title:'title',chairperson:'chairperson_raw',secretary:'secretary_raw',attendees:'attendees_raw'};
const parse=(value) => {try{return JSON.parse(value || '{}');}catch{return {};}};
export function protocolImportSource(database,workspaceId,documentId) {
  const source=database.get(`SELECT dv.*,d.workspace_id,d.title AS document_title,d.lifecycle_status
    FROM documents d JOIN document_versions dv ON dv.id=d.current_version_id WHERE d.workspace_id=? AND d.id=?`,workspaceId,documentId);
  if (!source) throw new AppError('document_not_found','Документ не найден.',404);
  const run=database.get('SELECT result_json FROM extraction_runs WHERE document_version_id=? AND result_json IS NOT NULL ORDER BY started_at DESC,rowid DESC LIMIT 1',source.id);
  const protocol=parse(run?.result_json).protocol;
  const meeting=protocol?.id ? database.get('SELECT * FROM meetings WHERE workspace_id=? AND id=?',workspaceId,protocol.id)
    : database.get('SELECT * FROM meetings WHERE workspace_id=? AND source_document_version_id=?',workspaceId,source.id);
  return {source,meeting:meeting || null,protocol:protocol || null};
}
export function protocolCorrectionView(database,workspaceId,documentId,{includeText=false}={}) {
  const {source,meeting,protocol}=protocolImportSource(database,workspaceId,documentId);
  return {documentId,documentVersionId:source.id,originalName:source.original_name,processingStatus:source.processing_status,
    meetingId:meeting?.id || null,updatedAt:meeting?.updated_at || null,
    fields:Object.fromEntries(Object.entries(columns).map(([key,column]) => [key,meeting?.[column] || ''])),
    dateSource:protocol?.meetingDateRaw || null,sourceExcerpt:String(source.extracted_text || '').split('\n').slice(0,18).join('\n'),
    sourceText:includeText ? source.extracted_text || '' : undefined,
    originalUrl:`/api/documents/${encodeURIComponent(documentId)}/content?variant=original`};
}
export function correctProtocolMetadata(database,workspaceId,documentId,input,actor=null) {
  if (!input || !input.fields || typeof input.fields !== 'object' || Array.isArray(input.fields)) throw new AppError('protocol_correction_invalid','Передайте изменённые поля протокола.',400);
  const fields={};
  for (const [key,value] of Object.entries(input.fields)) {
    if (!Object.hasOwn(columns,key) || (value !== null && typeof value !== 'string') || String(value || '').length > (key === 'attendees' ? 20000 : 2000)) {
      throw new AppError('protocol_correction_invalid','Поле не поддерживается или его значение слишком длинное.',400);
    }
    fields[key]=String(value || '').trim();
  }
  return database.transaction(() => {
    const {source,meeting}=protocolImportSource(database,workspaceId,documentId);
    if (source.id !== input.documentVersionId) throw new AppError('protocol_source_changed','Версия документа изменилась. Откройте правку заново.',409);
    if (source.lifecycle_status === 'archived') throw new AppError('protocol_source_archived','Документ находится в архиве. Сначала восстановите его.',409);
    const uploadAgeMs = source.uploaded_at ? (Date.now() - new Date(source.uploaded_at).getTime()) : 0;
    if (['queued','extracting'].includes(source.processing_status) && !input.force && uploadAgeMs < 25000) {
      throw new AppError('protocol_processing','Документ ещё обрабатывается. Дождитесь результата перед правкой.',409);
    }
    const now=new Date().toISOString();
    let currentMeeting = meeting;
    if (!currentMeeting) {
      const meetingId = newId('meeting');
      const docTitle = fields.title || source.document_title || 'Заседание кафедры';
      database.run(`
        INSERT INTO meetings(
          id, workspace_id, source_document_version_id, protocol_number, meeting_date,
          title, chairperson_raw, secretary_raw, attendees_raw, confidence, status,
          evidence_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1.0, 'confirmed_auto', '{}', ?, ?)
      `, meetingId, workspaceId, source.id, fields.protocolNumber || null, fields.meetingDate || null,
      docTitle, fields.chairperson || null, fields.secretary || null, fields.attendees || null, now, now);
      database.run("UPDATE document_versions SET processing_status = 'processed', extraction_error = NULL WHERE id = ?", source.id);
      database.run("UPDATE documents SET status = 'processed', document_type = 'department_protocol', updated_at = ? WHERE id = ?", now, documentId);
      currentMeeting = database.get('SELECT * FROM meetings WHERE id = ?', meetingId);
      writeAudit(database, workspaceId, actor, 'meeting.created_from_unparsed_protocol', 'meeting', meetingId, { documentId, fields }, now);
      syncMeetingSearch(database, workspaceId, meetingId);
      resolveMeetingReviews(database, workspaceId, meetingId, { scope: 'meeting' }, actor, now);
      database.run(`
        UPDATE review_items
        SET status = 'resolved', resolved_at = ?, resolution_json = ?
        WHERE workspace_id = ? AND source_kind = 'document_version' AND source_id = ? AND status = 'open'
      `, now, JSON.stringify({ resolvedBy: 'operator_metadata_entry', meetingId }), workspaceId, source.id);
      return { ...protocolCorrectionView(database, workspaceId, documentId), duplicateRequest: false };
    }
    database.run("UPDATE document_versions SET processing_status = 'processed', extraction_error = NULL WHERE id = ?", source.id);
    database.run("UPDATE documents SET status = 'processed', document_type = 'department_protocol', updated_at = ? WHERE id = ?", now, documentId);
    database.run(`
      UPDATE review_items
      SET status = 'resolved', resolved_at = ?, resolution_json = ?
      WHERE workspace_id = ? AND source_kind = 'document_version' AND source_id = ? AND status = 'open'
    `, now, JSON.stringify({ resolvedBy: 'operator_metadata_update', meetingId: currentMeeting.id }), workspaceId, source.id);
    const changed=Object.keys(fields).filter((key) => String(currentMeeting[columns[key]] || '') !== fields[key]);
    if (!changed.length) return {...protocolCorrectionView(database,workspaceId,documentId),duplicateRequest:true};
    if (input.expectedUpdatedAt && input.expectedUpdatedAt !== currentMeeting.updated_at) throw new AppError('protocol_correction_stale','Заседание изменилось после открытия формы. Обновите строку; введённые правки сохранены в форме.',409);
    const basic=Object.fromEntries(changed.filter((key) => ['protocolNumber','meetingDate','title'].includes(key)).map((key) => [key,fields[key]]));
    const raw=changed.filter((key) => !Object.hasOwn(basic,key));
    if (Object.keys(basic).length) updateMeeting(database,workspaceId,currentMeeting.id,basic,actor,now);
    if (raw.length) {
      const live=database.get('SELECT * FROM meetings WHERE id=?',currentMeeting.id);const evidence=parse(live.evidence_json);
      const correction={at:now,actorPersonId:actor,fields:raw,before:Object.fromEntries(raw.map((key) => [key,live[columns[key]]])),after:Object.fromEntries(raw.map((key) => [key,fields[key]]))};
      const history=[...(evidence.manualCorrections || []),correction];
      for (const key of raw) database.run(`UPDATE meetings SET ${columns[key]}=? WHERE id=?`,fields[key] || null,currentMeeting.id);
      database.run('UPDATE meetings SET evidence_json=?,updated_at=? WHERE id=?',JSON.stringify({...evidence,manualCorrections:history}),now,currentMeeting.id);
      const updated=database.get('SELECT * FROM meetings WHERE id=?',currentMeeting.id);
      database.run("UPDATE calendar_items SET description=?,updated_at=? WHERE workspace_id=? AND source_kind='meeting' AND source_id=?",
        [updated.title,updated.chairperson_raw,updated.secretary_raw,updated.attendees_raw].filter(Boolean).join('\n'),now,workspaceId,currentMeeting.id);
      resolveMeetingReviews(database,workspaceId,currentMeeting.id,{scope:'meeting',touchedFields:[...raw,...raw.map((key) => columns[key])]},actor,now);
      writeAudit(database,workspaceId,actor,'meeting.metadata.corrected','meeting',currentMeeting.id,correction,now);
      syncMeetingSearch(database,workspaceId,currentMeeting.id);
    }
    return {...protocolCorrectionView(database,workspaceId,documentId),duplicateRequest:false};
  });
}
