import { extractText } from '../../document-intake/src/extract-text.mjs';
import { buildDocumentPreview } from '../../document-intake/src/preview.mjs';
import { supportedFormat } from '../../document-intake/src/formats.mjs';
import { newId } from '../../core/src/ids.mjs';
import { addSearchFragment } from '../../storage/src/search.mjs';
import { replaceDocumentBlocks } from '../../storage/src/document-structure.mjs';
import { extractPlan } from './extractor.mjs';
import { getPlanIngestHint, persistPlan } from './service.mjs';

function insertReview(database, workspaceId, versionId, code, title, explanation, proposedAction, context = {}) {
  const existing = database.get(`
    SELECT 1 AS present FROM review_items
    WHERE workspace_id = ? AND source_kind = 'document_version'
      AND source_id = ? AND issue_code = ? AND status = 'open'
  `, workspaceId, versionId, code);
  if (existing) return;
  database.run(`
    INSERT INTO review_items(
      id, workspace_id, source_kind, source_id, issue_code, title, explanation,
      proposed_action, severity, status, context_json, created_at
    ) VALUES (?, ?, 'document_version', ?, ?, ?, ?, ?, 'warning', 'open', ?, ?)
  `, newId('review'), workspaceId, versionId, code, title, explanation,
  proposedAction, JSON.stringify(context), new Date().toISOString());
}

function persistPreviewBlob(database, preview, now) {
  if (!preview?.blob) return;
  database.run(`
    INSERT OR IGNORE INTO file_blobs(sha256, size_bytes, media_type, storage_path, created_at)
    VALUES (?, ?, ?, ?, ?)
  `, preview.blob.sha256, preview.blob.sizeBytes,
  preview.mediaType || preview.blob.mediaType, preview.blob.storagePath, now);
}

function ocrReview(database, version, ocr) {
  if (!['unavailable', 'failed', 'empty', 'disabled'].includes(ocr?.status)) return;
  insertReview(
    database,
    version.workspace_id,
    version.id,
    `plan_ocr_${ocr.status}`,
    'План требует распознавания',
    ocr.status === 'disabled'
      ? 'OCR отключён, а в документе недостаточно текстового слоя.'
      : `Автоматическое распознавание не дало пригодного текста${ocr.error ? `: ${ocr.error}` : '.'}`,
    'Проверьте качество файла и локальные средства OCR; оригинал уже сохранён.',
    { ocr }
  );
}

export async function processPlanDocumentJob(database, payload, logger, config, {
  templateOnly = false
} = {}) {
  const version = database.get(`
    SELECT dv.*, d.title, d.workspace_id, fb.storage_path, fb.size_bytes
    FROM document_versions dv
    JOIN documents d ON d.id = dv.document_id
    JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    WHERE dv.id = ? AND d.id = ?
  `, payload.versionId, payload.documentId);
  if (!version) throw new Error(`Document version not found: ${payload.versionId}`);
  if (['processed', 'needs_review'].includes(version.processing_status)) {
    const existing = templateOnly ? true : database.get(
      'SELECT 1 AS present FROM plans WHERE source_document_version_id = ?', version.id
    );
    if (existing) {
      logger.info('plan document already finalized; retry is idempotent', {
        versionId: version.id,
        templateOnly,
        status: version.processing_status
      });
      return;
    }
  }

  const startedAt = new Date().toISOString();
  const extractionRunId = newId('extract');
  database.run(`
    INSERT INTO extraction_runs(
      id, document_version_id, extractor_code, extractor_version, status,
      confidence, result_json, started_at
    ) VALUES (?, ?, ?, '1', 'running', NULL, NULL, ?)
  `, extractionRunId, version.id, templateOnly ? 'plan-template-structure' : 'plan-deterministic', startedAt);
  database.run(`
    UPDATE document_versions
    SET processing_status = 'extracting', extraction_error = NULL,
      preview_status = 'pending', preview_error = NULL
    WHERE id = ?
  `, version.id);
  database.run("UPDATE documents SET status = 'processing', updated_at = ? WHERE id = ?", startedAt, version.document_id);

  try {
    if (!supportedFormat(version.detected_format)) {
      insertReview(database, version.workspace_id, version.id, 'plan_unsupported_format',
        'Формат плана пока не разбирается',
        `Файл «${version.original_name}» сохранён, но формат ${version.detected_format} требует конвертации.`,
        'Преобразуйте файл в DOCX, XLSX, ODT, ODS или PDF либо подключите локальный конвертер.',
        { format: version.detected_format });
      const completedAt = new Date().toISOString();
      database.run(`
        UPDATE document_versions
        SET processing_status = 'needs_review', structure_status = 'unsupported', preview_status = 'unsupported'
        WHERE id = ?
      `, version.id);
      database.run("UPDATE documents SET status = 'needs_review', updated_at = ? WHERE id = ?", completedAt, version.document_id);
      database.run(`
        UPDATE extraction_runs SET status = 'needs_review', completed_at = ? WHERE id = ?
      `, completedAt, extractionRunId);
      return;
    }

    const extracted = await extractText({
      path: version.storage_path,
      format: version.detected_format,
      tempDir: config.tempDir,
      ocr: {
        enabled: config.ocrEnabled,
        languages: config.ocrLanguages,
        dpi: config.ocrDpi,
        maxPages: config.ocrMaxPages,
        minCharacters: config.ocrMinCharacters
      }
    });
    const preview = await buildDocumentPreview({
      sourcePath: version.storage_path,
      format: version.detected_format,
      originalName: version.original_name,
      originalMediaType: version.media_type,
      originalBlob: {
        sha256: version.blob_sha256,
        sizeBytes: version.size_bytes,
        storagePath: version.storage_path,
        mediaType: version.media_type
      },
      blobDir: config.blobDir,
      tempDir: config.tempDir,
      enabled: config.previewEnabled
    });
    const text = extracted.text || '';
    const blocks = Array.isArray(extracted.blocks) ? extracted.blocks : [];
    const ocr = extracted.diagnostics?.ocr || {
      status: 'not_needed', engine: null, languages: null, confidence: null, error: null
    };
    const completedAt = new Date().toISOString();
    let planResult = null;
    let persistedPlan = null;
    let finalStatus = text ? 'processed' : 'needs_review';
    let finalType = templateOnly ? 'plan_template' : 'plan';

    if (!text) {
      insertReview(database, version.workspace_id, version.id, 'plan_empty_text',
        templateOnly ? 'В шаблоне плана не найден текст' : 'В плане не найден текст',
        'Оригинал сохранён, но текстовый слой и результат OCR пусты.',
        'Проверьте качество файла или загрузите документ с текстовым слоем.',
        { format: version.detected_format, ocr });
      ocrReview(database, version, ocr);
    } else if (!templateOnly) {
      const hint = getPlanIngestHint(database, version.workspace_id, version.id) || {};
      planResult = extractPlan({
        text,
        title: version.title,
        blocks,
        hints: {
          planScope: hint.plan_scope || null,
          periodKind: hint.period_kind || null,
          periodKey: hint.period_key || null,
          ownerPersonId: hint.owner_person_id || null,
          sourceTemplateId: hint.source_template_id || null,
          requestedType: payload.requestedType || 'plan'
        }
      });
      finalType = `${planResult.planScope || 'unit'}_plan`;
      if (!planResult.items.length || !planResult.periodKey) finalStatus = 'needs_review';
      if (planResult.planScope === 'personal' && !planResult.ownerPersonId && !planResult.ownerRaw) {
        finalStatus = 'needs_review';
      }
    }

    database.transaction(() => {
      persistPreviewBlob(database, preview, completedAt);
      replaceDocumentBlocks(database, {
        documentVersionId: version.id,
        blocks,
        extractor: extracted.extractor,
        version: extracted.version,
        now: completedAt
      });
      if (text) {
        addSearchFragment(database, {
          workspaceId: version.workspace_id,
          sourceKind: 'document',
          sourceId: version.document_id,
          documentVersionId: version.id,
          title: version.title,
          content: text,
          locator: { kind: version.detected_format, scope: 'full_document' }
        });
      }
      if (planResult) {
        persistedPlan = persistPlan(database, {
          workspaceId: version.workspace_id,
          documentVersionId: version.id,
          documentTitle: version.title,
          result: planResult,
          now: completedAt
        });
      }
      database.run(`
        UPDATE document_versions
        SET processing_status = ?, extracted_text = ?, extraction_error = NULL,
          ocr_status = ?, ocr_engine = ?, ocr_languages = ?, ocr_confidence = ?, ocr_error = ?,
          preview_status = ?, preview_blob_sha256 = ?, preview_media_type = ?, preview_error = ?
        WHERE id = ?
      `, finalStatus, text, ocr.status, ocr.engine, ocr.languages, ocr.confidence, ocr.error,
      preview.status, preview.blob?.sha256 || null, preview.mediaType || null, preview.error || null,
      version.id);
      database.run(`
        UPDATE documents SET document_type = ?, status = ?, updated_at = ? WHERE id = ?
      `, finalType, finalStatus, completedAt, version.document_id);
      database.run(`
        UPDATE extraction_runs
        SET extractor_code = ?, extractor_version = '1', status = ?, confidence = ?,
          result_json = ?, completed_at = ?
        WHERE id = ?
      `, templateOnly ? 'plan-template-structure' : 'plan-deterministic',
      finalStatus === 'processed' ? 'completed' : 'needs_review',
      planResult?.confidence ?? (text ? 1 : 0),
      JSON.stringify({
        textExtractor: { code: extracted.extractor, version: extracted.version },
        ocr,
        preview: { status: preview.status, mediaType: preview.mediaType, error: preview.error },
        plan: planResult ? {
          id: persistedPlan?.id || null,
          scope: planResult.planScope,
          periodKind: planResult.periodKind,
          periodKey: planResult.periodKey,
          itemCount: planResult.items.length
        } : null,
        planTemplate: templateOnly
      }), completedAt, extractionRunId);
    });

    logger.info(templateOnly ? 'plan template document processed' : 'plan document processed', {
      documentId: version.document_id,
      versionId: version.id,
      planId: persistedPlan?.id || null,
      itemCount: planResult?.items?.length || 0,
      status: finalStatus,
      ocrStatus: ocr.status,
      previewStatus: preview.status
    });
  } catch (error) {
    const completedAt = new Date().toISOString();
    database.run(`
      UPDATE document_versions
      SET processing_status = 'failed', extraction_error = ?, structure_status = 'failed',
        preview_status = 'failed', preview_error = ?
      WHERE id = ?
    `, String(error?.message || error), String(error?.message || error), version.id);
    database.run("UPDATE documents SET status = 'failed', updated_at = ? WHERE id = ?", completedAt, version.document_id);
    database.run(`
      UPDATE extraction_runs
      SET status = 'failed', error_code = ?, error_message = ?, completed_at = ?
      WHERE id = ?
    `, error.code || 'plan_processing_failed', String(error?.message || error), completedAt, extractionRunId);
    throw error;
  }
}
