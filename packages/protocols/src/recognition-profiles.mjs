import { createHash } from 'node:crypto';
import { AppError } from '../../core/src/errors.mjs';
import { newId } from '../../core/src/ids.mjs';
import { extractDepartmentProtocol } from './extractor.mjs';
import { markerKey, normalizeMarkerAliases, protocolMarkers } from './recognition-markers.mjs';
import { writeAudit } from './meeting-common.mjs';

function decode(row) {
  try {
    const matcher=JSON.parse(row.matcher_json);
    if (row.document_type !== 'protocol_recognition' || !matcher.protocolMarkers) return null;
    return {id:row.id,name:row.name,code:row.code,version:row.version,status:row.status,
      matcher,aliases:normalizeMarkerAliases(matcher.protocolMarkers)};
  } catch { return null; }
}
const normalizedText=(value) => String(value || '').toLocaleLowerCase('ru-RU').replace(/ё/gu,'е').replace(/\s+/gu,' ').trim();
function matches(profile,text,filename) {
  const matcher=profile.matcher;
  return (!matcher.filenameContains || normalizedText(filename).includes(normalizedText(matcher.filenameContains)))
    && (matcher.requiredPhrases || []).every((phrase) => normalizedText(text).includes(normalizedText(phrase)));
}
export function listRecognitionProfiles(database,workspaceId) {
  return database.all(`SELECT * FROM document_templates WHERE workspace_id=? AND document_type='protocol_recognition'
    AND status='active' ORDER BY name,version DESC`,workspaceId).map(decode).filter(Boolean);
}
export function matchingRecognitionProfiles(database,workspaceId,text,filename) {
  const profiles=listRecognitionProfiles(database,workspaceId).filter((profile) => matches(profile,text,filename));
  const aliases={};const kinds=new Map();const conflicts=[];
  for (const profile of profiles) for (const [kind,values] of Object.entries(profile.aliases)) for (const value of values) {
    const key=markerKey(value);
    if (kinds.has(key) && kinds.get(key) !== kind) conflicts.push(value);
    kinds.set(key,kind);(aliases[kind] ||= []).push(value);
  }
  return {aliases:conflicts.length ? {} : normalizeMarkerAliases(aliases),profiles:profiles.map(({id,name,version}) => ({id,name,version})),conflicts:[...new Set(conflicts)]};
}
function normalize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('recognition_input_invalid','Некорректные параметры формата.',400);
  const name=String(input.name || '').trim();const phrase=String(input.requiredPhrase || '').trim();
  const filenameContains=String(input.filenameContains || '').trim();
  if (!name || name.length > 120) throw new AppError('recognition_name_invalid','Укажите название формата до 120 символов.',400);
  if ((!phrase && !filenameContains) || phrase.length > 160 || filenameContains.length > 120) {
    throw new AppError('recognition_scope_required','Укажите общую фразу до 160 символов или часть имени файла до 120 символов.',400);
  }
  const source=input.aliases;
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new AppError('recognition_markers_required','Укажите обозначения разделов.',400);
  for (const [kind,values] of Object.entries(source)) {
    if (!Object.hasOwn(protocolMarkers,kind) || !Array.isArray(values) || values.length > 16 || values.some((value) =>
      typeof value !== 'string' || value.trim().length < 3 || value.trim().length > 64 || /[\r\n]/u.test(value))) {
      throw new AppError('recognition_markers_invalid','Для раздела допустимо до 16 обозначений длиной от 3 до 64 символов, без переноса строки.',400);
    }
  }
  const aliases=normalizeMarkerAliases(source);
  if (!Object.values(aliases).some((values) => values.length)) throw new AppError('recognition_markers_required','Добавьте хотя бы одно обозначение раздела.',400);
  const destinations=new Map(Object.entries(protocolMarkers).flatMap(([kind,values]) => values.map((value) => [markerKey(value),kind])));
  for (const [kind,values] of Object.entries(aliases)) for (const value of values) {
    const key=markerKey(value);
    if (destinations.has(key) && destinations.get(key) !== kind) throw new AppError('recognition_marker_conflict','Одно обозначение нельзя назначить разным разделам.',400);
    destinations.set(key,kind);
  }
  return {name,aliases,matcher:{requiredPhrases:phrase ? [phrase] : [],filenameContains,protocolMarkers:aliases}};
}
export function previewRecognitionProfile(database,workspaceId,input) {
  const profile=normalize(input);
  const source=database.get(`SELECT dv.id,dv.extracted_text,dv.original_name,dv.processing_status,d.lifecycle_status
    FROM documents d JOIN document_versions dv ON dv.id=d.current_version_id WHERE d.workspace_id=? AND d.id=?`,workspaceId,input.documentId);
  if (!source) throw new AppError('document_not_found','Исходный документ не найден.',404);
  if (input.documentVersionId && source.id !== input.documentVersionId) throw new AppError('recognition_source_changed','Версия документа изменилась. Откройте образец заново.',409);
  if (['queued','extracting'].includes(source.processing_status)) throw new AppError('recognition_source_processing','Документ ещё обрабатывается. Правки формата можно проверить после завершения.',409);
  if (!source.extracted_text) throw new AppError('document_text_not_ready','Нет извлечённого текста. Исходник сохранён; проверьте чтение файла или распознавание скана.',409);
  return {matched:matches(profile,source.extracted_text,source.original_name),profile,documentVersionId:source.id,
    result:extractDepartmentProtocol(source.extracted_text,{aliases:profile.aliases})};
}
function sameProfile(row,profile) {const decoded=decode(row || {});return decoded && decoded.name === profile.name && JSON.stringify(decoded.matcher) === JSON.stringify(profile.matcher);}
export function saveRecognitionProfile(database,workspaceId,input,actorPersonId=null) {
  const preview=previewRecognitionProfile(database,workspaceId,input);
  if (!preview.matched) throw new AppError('recognition_sample_mismatch','Условие не совпадает с образцом. Исправьте фразу или имя файла.',400);
  return database.transaction(() => {
    const currentSource=database.get('SELECT d.current_version_id,dv.processing_status FROM documents d JOIN document_versions dv ON dv.id=d.current_version_id WHERE d.id=? AND d.workspace_id=?',input.documentId,workspaceId);
    if (!currentSource || currentSource.current_version_id !== preview.documentVersionId || ['queued','extracting'].includes(currentSource.processing_status)) throw new AppError('recognition_source_changed','Образец изменился или обрабатывается. Проверьте его заново.',409);
    let previous=null;let code;
    if (input.profileId) {
      const requested=database.get('SELECT * FROM document_templates WHERE workspace_id=? AND id=?',workspaceId,input.profileId);
      if (!decode(requested || {})) throw new AppError('recognition_profile_not_found','Формат не найден.',404);
      code=requested.code;
      previous=database.get("SELECT * FROM document_templates WHERE workspace_id=? AND code=? AND status='active' ORDER BY version DESC LIMIT 1",workspaceId,code);
      if (sameProfile(previous,preview.profile)) return {...preview,id:previous.id,version:previous.version,duplicateRequest:true};
      if (!previous || previous.id !== requested.id) throw new AppError('recognition_profile_stale','Формат уже изменён. Откройте его заново, чтобы не затереть чужую правку.',409);
    } else {
      code=`protocol_recognition_${createHash('sha256').update(JSON.stringify(preview.profile)).digest('hex').slice(0,32)}`;
      const existing=database.get("SELECT * FROM document_templates WHERE workspace_id=? AND code=? AND status='active' ORDER BY version DESC LIMIT 1",workspaceId,code);
      if (sameProfile(existing,preview.profile)) return {...preview,id:existing.id,version:existing.version,duplicateRequest:true};
      if (existing) throw new AppError('recognition_profile_exists','Такой формат уже изменён. Выберите его в списке.',409);
    }
    const id=newId('template');const now=new Date().toISOString();
    const version=Number(database.get('SELECT MAX(version) AS version FROM document_templates WHERE workspace_id=? AND code=?',workspaceId,code)?.version || 0)+1;
    if (previous) database.run("UPDATE document_templates SET status='archived',updated_at=? WHERE id=?",now,previous.id);
    database.run(`INSERT INTO document_templates(id,workspace_id,name,code,document_type,status,matcher_json,fields_json,
      source_document_version_id,version,usage_count,created_at,updated_at) VALUES(?,?,?,?,'protocol_recognition','active',?,'[]',?,?,0,?,?)`,
    id,workspaceId,preview.profile.name,code,JSON.stringify(preview.profile.matcher),preview.documentVersionId,version,now,now);
    writeAudit(database,workspaceId,actorPersonId,'protocol.recognition_profile.saved','document_template',id,
      {previousId:previous?.id || null,version,documentVersionId:preview.documentVersionId},now);
    return {...preview,id,version,duplicateRequest:false};
  });
}
