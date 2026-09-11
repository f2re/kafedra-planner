import { listProtocolImports } from '../../../packages/protocols/src/protocol-imports.mjs';
import { AppError } from '../../../packages/core/src/errors.mjs';
import { requireRole } from '../../../packages/auth/src/policy.mjs';
import { assertObjectAccess } from '../../../packages/access-control/src/service.mjs';
import { listRecognitionProfiles, previewRecognitionProfile, saveRecognitionProfile } from '../../../packages/protocols/src/recognition-profiles.mjs';
import { protocolCorrectionView, correctProtocolMetadata } from '../../../packages/protocols/src/import-corrections.mjs';
import { createMeetingsRouter as createBaseMeetingsRouter } from './meetings-router.mjs';
import { readJson, sendJson } from './http-utils.mjs';

function workspace(database,request) {
  if (request.auth?.enabled) {
    if (!request.auth.workspaceId) throw new AppError('workspace_not_found','Рабочая область не найдена.',404);
    return request.auth.workspaceId;
  }
  const requested=request.headers['x-workspace-id'];
  const row=typeof requested === 'string' ? database.get('SELECT id FROM workspaces WHERE id=? OR code=?',requested,requested)
    : database.get('SELECT id FROM workspaces ORDER BY created_at LIMIT 1');
  if (!row) throw new AppError('workspace_not_found','Рабочая область не найдена.',404);
  return row.id;
}
function documentAccess(database,workspaceId,request,id,action) {
  if (request.auth?.enabled) assertObjectAccess(database,workspaceId,request.auth,'document',id,action);
}
export function createMeetingsRouter(options) {
  const fallback=createBaseMeetingsRouter(options);const {database}=options;
  return async function routeProtocolImports(request,response,url) {
    const path=url.pathname;const correction=path.match(/^\/api\/protocol-imports\/([^/]+)\/correction$/u);
    if (path !== '/api/protocol-imports' && path !== '/api/protocol-imports/recognition' && path !== '/api/protocol-imports/tools' && !correction) return fallback(request,response,url);
    const workspaceId=workspace(database,request);const actor=request.auth?.personId || null;
    if (request.method === 'GET' && path === '/api/protocol-imports') {
      try {sendJson(response,200,listProtocolImports(database,workspaceId,url.searchParams.get('year'),url.searchParams.get('limit') || 500,url.searchParams.get('offset') || 0));}
      catch(error) {if (error.code === 'protocol_import_year_invalid') throw new AppError(error.code,'Укажите календарный год от 2000 до 2100.',400);throw error;}
      return true;
    }
    if (request.method === 'GET' && path === '/api/protocol-imports/tools') {
      const documentId=url.searchParams.get('documentId');
      if (!documentId) {sendJson(response,200,{workspaceId,profiles:listRecognitionProfiles(database,workspaceId)});return true;}
      documentAccess(database,workspaceId,request,documentId,'read');
      sendJson(response,200,{workspaceId,...protocolCorrectionView(database,workspaceId,documentId,{includeText:url.searchParams.get('text') === '1'})});return true;
    }
    if (request.method === 'GET' && path === '/api/protocol-imports/recognition') {
      sendJson(response,200,{items:listRecognitionProfiles(database,workspaceId)});return true;
    }
    if (path === '/api/protocol-imports/recognition' && ['POST','PUT'].includes(request.method)) {
      const input=await readJson(request);
      if (request.auth?.enabled && request.method === 'PUT') requireRole(request.auth,['manager','admin']);
      documentAccess(database,workspaceId,request,input.documentId,request.method === 'PUT' ? 'edit' : 'read');
      const result=request.method === 'PUT' ? saveRecognitionProfile(database,workspaceId,input,actor) : previewRecognitionProfile(database,workspaceId,input);
      sendJson(response,200,result);return true;
    }
    if (correction && request.method === 'PATCH') {
      const documentId=decodeURIComponent(correction[1]);documentAccess(database,workspaceId,request,documentId,'edit');
      try {sendJson(response,200,correctProtocolMetadata(database,workspaceId,documentId,await readJson(request),actor));}
      catch (error) {
        if (error instanceof AppError) throw error;
        const code=error.code || error.message;
        const messages={meeting_date_invalid:'Укажите корректную дату заседания.',meeting_date_required:'Укажите дату заседания.',meeting_protocol_number_required:'Укажите номер протокола.',meeting_title_required:'Укажите название заседания.',meeting_duplicate:'Заседание с таким номером и датой уже существует.'};
        if (messages[code]) throw new AppError(code,messages[code],code === 'meeting_duplicate' ? 409 : 400);
        throw error;
      }
      return true;
    }
    throw new AppError('method_not_allowed','Операция не поддерживается.',405);
  };
}
