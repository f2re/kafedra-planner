import { AppError } from '../../../packages/core/src/errors.mjs';
import {
  addAgendaItem,
  analyzeMeetingTemplate,
  createMeeting,
  deleteAgendaItem,
  generateMeetingDocument,
  getMeeting,
  getMeetingSettings,
  listAgendaSources,
  listMeetings,
  listMeetingLinks,
  meetingSettingsResources,
  moveAgendaItem,
  saveMeetingSettings,
  saveMeetingTemplateProfile,
  updateAgendaItem,
  updateMeeting,
  uploadMeetingTemplate
} from '../../../packages/protocols/src/meetings.mjs';
import { readJson, sendJson } from './http-utils.mjs';

function workspaceOf(database, request) {
  if (request.auth?.workspaceId) {
    const workspace = database.get('SELECT * FROM workspaces WHERE id = ?', request.auth.workspaceId);
    if (workspace) return workspace;
  }
  const requested = request.headers['x-workspace-id'];
  if (typeof requested === 'string') {
    const workspace = database.get('SELECT * FROM workspaces WHERE id = ? OR code = ?', requested, requested);
    if (workspace) return workspace;
  }
  const workspace = database.get('SELECT * FROM workspaces ORDER BY created_at LIMIT 1');
  if (!workspace) throw new AppError('workspace_not_initialized', 'Рабочее пространство не создано.', 500);
  return workspace;
}

function mappedError(cause) {
  if (cause instanceof AppError) return cause;
  const code = String(cause?.code || cause?.message || cause);
  const messages = {
    meeting_settings_incomplete: ['Сначала укажите шаблоны, кворум, председателя и секретаря в настройках заседаний.', 409],
    meeting_quorum_invalid: ['Кворум должен быть целым числом больше нуля.', 400],
    meeting_chairperson_invalid: ['Выберите действующего сотрудника в качестве председателя.', 400],
    meeting_secretary_invalid: ['Выберите действующего сотрудника в качестве секретаря.', 400],
    meeting_template_not_found: ['Выбранный шаблон не найден.', 404],
    meeting_template_name_required: ['Передайте имя DOCX-шаблона.', 400],
    meeting_template_kind_invalid: ['Не удалось определить назначение шаблона.', 400],
    meeting_template_must_be_docx: ['Не удалось прочитать DOCX. Проверьте, что файл открывается в Word или LibreOffice.', 400],
    meeting_template_agenda_marker_required: ['В совместимом старом шаблоне нужен отдельный абзац {{AGENDA}}.', 422],
    meeting_template_marker_loop: ['Шаблон содержит некорректное повторение служебного маркера.', 422],
    meeting_template_bindings_required: ['Назначьте хотя бы одно поле в документе.', 400],
    meeting_template_bindings_too_many: ['В одном профиле слишком много назначений полей.', 400],
    meeting_template_field_invalid: ['Выбрано неизвестное поле шаблона.', 400],
    meeting_template_field_duplicate: ['Одно поле нельзя назначить двум местам одновременно.', 409],
    meeting_template_locator_stale: ['Документ изменился или выбранное место больше не существует. Повторно откройте шаблон.', 409],
    meeting_template_structure_changed: ['Структура DOCX изменилась после открытия. Повторите анализ текущей версии.', 409],
    meeting_template_range_invalid: ['Выделенный диапазон текста некорректен.', 400],
    meeting_template_ranges_overlap: ['Назначенные поля пересекаются. Уточните выделение.', 409],
    meeting_template_repeat_required: ['Назначьте поля одного вопроса повестки, чтобы определить повторяемый блок.', 422],
    meeting_template_repeat_invalid: ['Повторяемый блок больше не соответствует документу.', 409],
    meeting_template_repeat_incompatible: ['Поля вопроса должны находиться в одной строке таблицы либо в непрерывной группе абзацев.', 422],
    meeting_template_profile_incomplete: ['Шаблон ещё не готов: назначьте все обязательные поля и повторяемый вопрос.', 409],
    meeting_date_required: ['Укажите дату заседания.', 400],
    meeting_date_invalid: ['Укажите корректную дату заседания.', 400],
    meeting_protocol_number_required: ['Укажите номер протокола.', 400],
    meeting_title_required: ['Укажите название заседания.', 400],
    meeting_duplicate: ['Заседание с таким номером протокола на эту дату уже существует.', 409],
    meeting_not_found: ['Заседание не найдено.', 404],
    agenda_title_required: ['Укажите текст вопроса повестки.', 400],
    agenda_source_not_found: ['Исходная задача или пункт плана не найдены.', 404],
    agenda_source_duplicate: ['Этот пункт уже включён в повестку данного заседания.', 409],
    agenda_item_not_found: ['Вопрос повестки не найден.', 404],
    agenda_move_invalid: ['Не удалось изменить порядок вопроса.', 400],
    meeting_document_kind_invalid: ['Можно сформировать только протокол или выписку.', 400],
    meeting_document_items_required: ['Отметьте хотя бы один вопрос для выписки.', 400],
    meeting_document_item_invalid: ['Один из выбранных вопросов не относится к этому заседанию.', 400],
    meeting_agenda_empty: ['Добавьте хотя бы один вопрос повестки.', 409]
  };
  const [message, status] = messages[code] || ['Не удалось выполнить операцию с заседанием.', 500];
  return new AppError(code, message, status);
}

export function createMeetingsRouter({ database, config }) {
  return async function routeMeetings(request, response, url) {
    const method = request.method || 'GET';
    const path = url.pathname;
    const meetingMatch = path.match(/^\/api\/meetings\/([^/]+)$/u);
    const agendaCollectionMatch = path.match(/^\/api\/meetings\/([^/]+)\/agenda$/u);
    const agendaItemMatch = path.match(/^\/api\/meetings\/([^/]+)\/agenda\/([^/]+)$/u);
    const agendaMoveMatch = path.match(/^\/api\/meetings\/([^/]+)\/agenda\/([^/]+)\/move$/u);
    const documentsMatch = path.match(/^\/api\/meetings\/([^/]+)\/documents$/u);
    const templateAnalysisMatch = path.match(/^\/api\/meeting-templates\/([^/]+)\/analysis$/u);
    const templateProfilesMatch = path.match(/^\/api\/meeting-templates\/([^/]+)\/profiles$/u);
    const recognized = path === '/api/meeting-settings'
      || path === '/api/meeting-agenda-sources'
      || path === '/api/meeting-links'
      || path === '/api/meeting-templates'
      || path === '/api/meetings'
      || meetingMatch || agendaCollectionMatch || agendaItemMatch || agendaMoveMatch || documentsMatch
      || templateAnalysisMatch || templateProfilesMatch;
    if (!recognized) return false;

    const workspace = workspaceOf(database, request);
    const actorPersonId = request.auth?.personId || null;

    try {
      if (method === 'GET' && path === '/api/meeting-settings') {
        return sendJson(response, 200, {
          settings: getMeetingSettings(database, workspace.id),
          resources: meetingSettingsResources(database, workspace.id)
        });
      }
      if (method === 'PUT' && path === '/api/meeting-settings') {
        const body = await readJson(request);
        const settings = saveMeetingSettings(database, workspace.id, body, actorPersonId);
        return sendJson(response, 200, { settings, resources: meetingSettingsResources(database, workspace.id) });
      }
      if (method === 'POST' && path === '/api/meeting-templates') {
        const encodedName = String(request.headers['x-file-name'] || '').trim();
        if (!encodedName) throw mappedError(Object.assign(new Error('meeting_template_name_required'), { code: 'meeting_template_name_required' }));
        let originalName = encodedName;
        try { originalName = decodeURIComponent(encodedName); } catch {}
        const uploaded = await uploadMeetingTemplate(database, config, workspace.id, request, {
          kind: String(url.searchParams.get('kind') || ''),
          originalName,
          actorPersonId
        });
        return sendJson(response, uploaded.duplicateRequest ? 200 : 201, uploaded);
      }
      if (templateAnalysisMatch && method === 'GET') {
        const versionId = decodeURIComponent(templateAnalysisMatch[1]);
        const kind = String(url.searchParams.get('kind') || '');
        return sendJson(response, 200, await analyzeMeetingTemplate(database, workspace.id, versionId, kind));
      }
      if (templateProfilesMatch && method === 'POST') {
        const versionId = decodeURIComponent(templateProfilesMatch[1]);
        const kind = String(url.searchParams.get('kind') || '');
        const body = await readJson(request);
        const profile = await saveMeetingTemplateProfile(
          database, config, workspace.id, versionId, kind, body, actorPersonId
        );
        return sendJson(response, profile.duplicateRequest ? 200 : 201, profile);
      }
      if (method === 'GET' && path === '/api/meeting-agenda-sources') {
        return sendJson(response, 200, {
          items: listAgendaSources(database, workspace.id, url.searchParams.get('q') || '', url.searchParams.get('limit') || 500)
        });
      }
      if (method === 'GET' && path === '/api/meeting-links') {
        const sourceKind = String(url.searchParams.get('sourceKind') || '');
        const sourceIds = String(url.searchParams.get('sourceIds') || '').split(',').map((value) => value.trim()).filter(Boolean);
        return sendJson(response, 200, { items: listMeetingLinks(database, workspace.id, sourceKind, sourceIds) });
      }
      if (method === 'GET' && path === '/api/meetings') {
        return sendJson(response, 200, { items: listMeetings(database, workspace.id, url.searchParams.get('limit') || 200) });
      }
      if (method === 'POST' && path === '/api/meetings') {
        const body = await readJson(request);
        return sendJson(response, 201, createMeeting(database, workspace.id, body, actorPersonId));
      }
      if (meetingMatch) {
        const meetingId = decodeURIComponent(meetingMatch[1]);
        if (method === 'GET') {
          const meeting = getMeeting(database, workspace.id, meetingId);
          if (!meeting) throw mappedError(Object.assign(new Error('meeting_not_found'), { code: 'meeting_not_found' }));
          return sendJson(response, 200, meeting);
        }
        if (method === 'PATCH') {
          const body = await readJson(request);
          return sendJson(response, 200, updateMeeting(database, workspace.id, meetingId, body, actorPersonId));
        }
      }
      if (agendaCollectionMatch && method === 'POST') {
        const meetingId = decodeURIComponent(agendaCollectionMatch[1]);
        const body = await readJson(request);
        return sendJson(response, 201, addAgendaItem(database, workspace.id, meetingId, body, actorPersonId));
      }
      if (agendaMoveMatch && method === 'POST') {
        const meetingId = decodeURIComponent(agendaMoveMatch[1]);
        const itemId = decodeURIComponent(agendaMoveMatch[2]);
        const body = await readJson(request);
        return sendJson(response, 200, moveAgendaItem(
          database, workspace.id, meetingId, itemId, String(body?.direction || ''), actorPersonId
        ));
      }
      if (agendaItemMatch) {
        const meetingId = decodeURIComponent(agendaItemMatch[1]);
        const itemId = decodeURIComponent(agendaItemMatch[2]);
        if (method === 'PATCH') {
          const body = await readJson(request);
          return sendJson(response, 200, updateAgendaItem(database, workspace.id, meetingId, itemId, body, actorPersonId));
        }
        if (method === 'DELETE') {
          return sendJson(response, 200, deleteAgendaItem(database, workspace.id, meetingId, itemId, actorPersonId));
        }
      }
      if (documentsMatch && method === 'POST') {
        const meetingId = decodeURIComponent(documentsMatch[1]);
        const body = await readJson(request);
        const generated = await generateMeetingDocument(database, config, workspace.id, meetingId, body, actorPersonId);
        return sendJson(response, generated.duplicateRequest ? 200 : 201, generated);
      }
    } catch (cause) {
      throw mappedError(cause);
    }
    return false;
  };
}
