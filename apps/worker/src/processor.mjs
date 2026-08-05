import { extractText } from '../../../packages/document-intake/src/extract-text.mjs';
import { supportedFormat } from '../../../packages/document-intake/src/formats.mjs';
import { looksLikeDepartmentProtocol, extractDepartmentProtocol } from '../../../packages/protocols/src/extractor.mjs';
import { persistProtocol } from '../../../packages/protocols/src/persist.mjs';
import { applyMatchingTemplates } from '../../../packages/templates/src/service.mjs';
import { newId } from '../../../packages/core/src/ids.mjs';
import { addSearchFragment } from '../../../packages/storage/src/search.mjs';

function insertReview(database, workspaceId, versionId, code, title, explanation, proposedAction, context = {}) {
  database.run(`
    INSERT INTO review_items(
      id, workspace_id, source_kind, source_id, issue_code, title, explanation,
      proposed_action, severity, status, context_json, created_at
    ) VALUES (?, ?, 'document_version', ?, ?, ?, ?, ?, 'warning', 'open', ?, ?)
  `, newId('review'), workspaceId, versionId, code, title, explanation,
  proposedAction, JSON.stringify(context), new Date().toISOString());
}

export async function processDocumentJob(database, payload, logger) {
  const version = database.get(`
    SELECT dv.*, d.title, d.workspace_id, fb.storage_path
    FROM document_versions dv
    JOIN documents d ON d.id = dv.document_id
    JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    WHERE dv.id = ? AND d.id = ?
  `, payload.versionId, payload.documentId);
  if (!version) throw new Error(`Document version not found: ${payload.versionId}`);
  if (['processed', 'needs_review'].includes(version.processing_status)) {
    logger.info('document already finalized; retry is idempotent', { versionId: version.id, status: version.processing_status });
    return;
  }

  const startedAt = new Date().toISOString();
  const extractionRunId = newId('extract');
  database.run(`
    INSERT INTO extraction_runs(
      id, document_version_id, extractor_code, extractor_version, status,
      confidence, result_json, started_at
    ) VALUES (?, ?, 'pending', '1', 'running', NULL, NULL, ?)
  `, extractionRunId, version.id, startedAt);
  database.run("UPDATE document_versions SET processing_status = 'extracting', extraction_error = NULL WHERE id = ?", version.id);
  database.run("UPDATE documents SET status = 'processing', updated_at = ? WHERE id = ?", startedAt, version.document_id);

  try {
    if (!supportedFormat(version.detected_format)) {
      insertReview(database, version.workspace_id, version.id, 'unsupported_format',
        'Формат требует отдельного обработчика',
        `Файл «${version.original_name}» сохранён, но формат ${version.detected_format} пока не разбирается автоматически.`,
        'Подключите конвертер LibreOffice, OCR или новый адаптер формата.',
        { format: version.detected_format });
      database.run("UPDATE document_versions SET processing_status = 'needs_review' WHERE id = ?", version.id);
      database.run("UPDATE documents SET status = 'needs_review', updated_at = ? WHERE id = ?", new Date().toISOString(), version.document_id);
      database.run(`
        UPDATE extraction_runs SET extractor_code = 'unsupported', status = 'needs_review', completed_at = ?
        WHERE id = ?
      `, new Date().toISOString(), extractionRunId);
      return;
    }

    const extracted = await extractText({ path: version.storage_path, format: version.detected_format });
    const text = extracted.text;
    if (!text) {
      insertReview(database, version.workspace_id, version.id, 'empty_text',
        'В документе не найден текст',
        'Файл прочитан, но текстовый слой пуст. Вероятно, это скан.',
        'Отправьте документ на OCR или загрузите версию с текстовым слоем.');
    }

    const isProtocol = payload.requestedType === 'protocol' || looksLikeDepartmentProtocol(text);
    const protocolResult = isProtocol ? extractDepartmentProtocol(text) : null;
    let templateApplications = [];
    let finalType = isProtocol ? 'department_protocol' : 'unknown';
    let finalStatus = isProtocol ? 'processed' : 'needs_review';
    let confidence = protocolResult?.confidence ?? null;
    let extractorCode = isProtocol ? 'department-protocol' : extracted.extractor;
    let extractorVersion = isProtocol ? '1' : extracted.version;

    database.transaction(() => {
      addSearchFragment(database, {
        workspaceId: version.workspace_id,
        sourceKind: 'document',
        sourceId: version.document_id,
        documentVersionId: version.id,
        title: version.title,
        content: text,
        locator: { kind: version.detected_format, scope: 'full_document' }
      });

      if (isProtocol) {
        persistProtocol(database, {
          workspaceId: version.workspace_id,
          documentVersionId: version.id,
          documentTitle: version.title,
          result: protocolResult
        });
      } else {
        templateApplications = applyMatchingTemplates(database, {
          workspaceId: version.workspace_id,
          version,
          text
        });
        if (templateApplications.length) {
          const best = templateApplications[0];
          finalType = best.template.document_type;
          finalStatus = best.result.missing.length ? 'needs_review' : 'processed';
          confidence = best.result.confidence;
          extractorCode = `template:${best.template.code}`;
          extractorVersion = String(best.template.version);
        } else {
          insertReview(database, version.workspace_id, version.id, 'document_type_unknown',
            'Не определён тип документа',
            'Текст извлечён и доступен для поиска, но подходящий шаблон не найден.',
            'Откройте документ и создайте шаблон: отметьте нужные поля, проверьте результат и сохраните.');
        }
      }

      database.run(`
        UPDATE document_versions
        SET processing_status = ?, extracted_text = ?, extraction_error = NULL
        WHERE id = ?
      `, finalStatus, text, version.id);
      database.run(`
        UPDATE documents
        SET document_type = ?, status = ?, updated_at = ?
        WHERE id = ?
      `, finalType, finalStatus, new Date().toISOString(), version.document_id);
      database.run(`
        UPDATE extraction_runs
        SET extractor_code = ?, extractor_version = ?, status = ?, confidence = ?, result_json = ?, completed_at = ?
        WHERE id = ?
      `, extractorCode, extractorVersion,
      finalStatus === 'processed' ? 'completed' : 'needs_review', confidence,
      JSON.stringify({
        textExtractor: { code: extracted.extractor, version: extracted.version },
        protocol: protocolResult,
        templates: templateApplications.map(({ template, result }) => ({
          id: template.id,
          code: template.code,
          confidence: result.confidence,
          missing: result.missing
        }))
      }),
      new Date().toISOString(), extractionRunId);
    });
    logger.info('document processed', {
      documentId: version.document_id,
      versionId: version.id,
      format: version.detected_format,
      type: finalType,
      templates: templateApplications.length
    });
  } catch (error) {
    database.run(`
      UPDATE document_versions SET processing_status = 'failed', extraction_error = ? WHERE id = ?
    `, String(error?.message || error), version.id);
    database.run("UPDATE documents SET status = 'failed', updated_at = ? WHERE id = ?", new Date().toISOString(), version.document_id);
    database.run(`
      UPDATE extraction_runs
      SET status = 'failed', error_code = ?, error_message = ?, completed_at = ?
      WHERE id = ?
    `, error.code || 'processing_failed', String(error?.message || error), new Date().toISOString(), extractionRunId);
    throw error;
  }
}

export async function dispatchJob(database, job, logger) {
  const payload = JSON.parse(job.payload_json);
  switch (job.kind) {
    case 'process_document':
      return processDocumentJob(database, payload, logger);
    default:
      throw new Error(`Unsupported job kind: ${job.kind}`);
  }
}
