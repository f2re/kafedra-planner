import { extractText } from '../../../packages/document-intake/src/extract-text.mjs';
import { buildDocumentPreview } from '../../../packages/document-intake/src/preview.mjs';
import { supportedFormat } from '../../../packages/document-intake/src/formats.mjs';
import { looksLikeDepartmentProtocol, extractDepartmentProtocol } from '../../../packages/protocols/src/extractor.mjs';
import { persistProtocol } from '../../../packages/protocols/src/persist.mjs';
import { protocolImportYear } from '../../../packages/protocols/src/protocol-imports.mjs';
import { applyMatchingTemplates } from '../../../packages/templates/src/service.mjs';
import { newId } from '../../../packages/core/src/ids.mjs';
import { addSearchFragment } from '../../../packages/storage/src/search.mjs';
import { replaceDocumentBlocks } from '../../../packages/storage/src/document-structure.mjs';
import { looksLikeDirective, extractDirective } from '../../../packages/work-management/src/extractor.mjs';
import { persistDirective, recordLlmRun } from '../../../packages/work-management/src/service.mjs';
import { proposeDirectiveWithLlama } from '../../../packages/ai/src/llama-client.mjs';
import { generateReportMatchCandidates } from '../../../packages/reports/src/service.mjs';
import { looksLikeScientificMaterial, extractScientificMaterial } from '../../../packages/science/src/extractor.mjs';
import { persistScientificItem } from '../../../packages/science/src/service.mjs';
import { extractPlan, looksLikePlan } from '../../../packages/plans/src/extractor.mjs';
import { persistPlan } from '../../../packages/plans/src/service.mjs';

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

function openReviewCount(database, workspaceId, versionId) {
  return Number(database.get(`
    SELECT COUNT(*) AS count FROM review_items
    WHERE workspace_id = ? AND source_kind = 'document_version'
      AND source_id = ? AND status = 'open'
  `, workspaceId, versionId)?.count || 0);
}

const RECOGNITION_REVIEW_CODES = [
  'empty_text', 'ocr_unavailable', 'ocr_failed', 'ocr_empty', 'ocr_disabled', 'ocr_partial'
];

function resolvePreviousRecognitionReviews(database, version, extractionRunId) {
  const now = new Date().toISOString();
  const placeholders = RECOGNITION_REVIEW_CODES.map(() => '?').join(', ');
  database.run(`
    UPDATE review_items
    SET status = 'resolved', resolved_at = ?, resolution_json = ?
    WHERE workspace_id = ? AND source_kind = 'document_version' AND source_id = ?
      AND status = 'open' AND issue_code IN (${placeholders})
  `, now, JSON.stringify({ kind: 'reprocess', extractionRunId }), version.workspace_id, version.id,
  ...RECOGNITION_REVIEW_CODES);
}

function ocrReview(database, version, ocr) {
  if (!['unavailable', 'failed', 'empty', 'disabled', 'partial'].includes(ocr?.status)) return;
  const failedPages = Array.isArray(ocr?.coverage?.failedPages) ? ocr.coverage.failedPages : [];
  const skippedPages = Array.isArray(ocr?.coverage?.skippedPages) ? ocr.coverage.skippedPages : [];
  const explanations = {
    unavailable: 'OCR не запущен: в системе отсутствует Tesseract или конвертер страниц PDF.',
    failed: `OCR завершился ошибкой: ${ocr.error || 'причина не определена'}.`,
    empty: 'OCR выполнен, но распознаваемый текст не найден.',
    disabled: 'OCR отключён в настройках системы.',
    partial: `OCR выполнен частично.${failedPages.length ? ` Ошибка страниц: ${failedPages.map((item) => item.page).join(', ')}.` : ''}${skippedPages.length ? ` Не обработаны из-за лимита: ${skippedPages.join(', ')}.` : ''}`
  };
  insertReview(
    database,
    version.workspace_id,
    version.id,
    `ocr_${ocr.status}`,
    ocr.status === 'partial' ? 'Документ распознан частично' : 'Требуется распознавание документа',
    explanations[ocr.status],
    ocr.status === 'partial'
      ? 'Хорошие страницы уже доступны. Устраните причину и повторите распознавание сохранённого источника.'
      : 'Проверьте качество скана, языковые пакеты OCR и настройки KAFEDRA_OCR_*.',
    { ocr }
  );
}

function persistPreviewBlob(database, preview, now) {
  if (!preview?.blob) return;
  database.run(`
    INSERT OR IGNORE INTO file_blobs(sha256, size_bytes, media_type, storage_path, created_at)
    VALUES (?, ?, ?, ?, ?)
  `, preview.blob.sha256, preview.blob.sizeBytes, preview.mediaType || preview.blob.mediaType,
  preview.blob.storagePath, now);
}

export async function processDocumentJob(database, payload, logger, config) {
  const version = database.get(`
    SELECT dv.*, d.title, d.workspace_id, fb.storage_path, fb.size_bytes
    FROM document_versions dv
    JOIN documents d ON d.id = dv.document_id
    JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    WHERE dv.id = ? AND d.id = ?
  `, payload.versionId, payload.documentId);
  if (!version) throw new Error(`Document version not found: ${payload.versionId}`);
  if (['processed', 'needs_review'].includes(version.processing_status)) {
    const reviewCount = openReviewCount(database, version.workspace_id, version.id);
    if (version.processing_status === 'processed' && reviewCount > 0) {
      const now = new Date().toISOString();
      database.run(`UPDATE document_versions SET processing_status = 'needs_review' WHERE id = ?`, version.id);
      database.run(`UPDATE documents SET status = 'needs_review', updated_at = ? WHERE id = ?`, now, version.document_id);
    }
    logger.info('document already finalized; retry is idempotent', {
      versionId: version.id,
      status: reviewCount > 0 ? 'needs_review' : version.processing_status
    });
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
  database.run(`
    UPDATE document_versions
    SET processing_status = 'extracting', extraction_error = NULL,
      preview_status = 'pending', preview_error = NULL
    WHERE id = ?
  `, version.id);
  database.run("UPDATE documents SET status = 'processing', updated_at = ? WHERE id = ?", startedAt, version.document_id);

  try {
    if (!supportedFormat(version.detected_format)) {
      insertReview(database, version.workspace_id, version.id, 'unsupported_format',
        'Формат требует отдельного обработчика',
        `Файл «${version.original_name}» сохранён, но формат ${version.detected_format} пока не разбирается автоматически.`,
        'Подключите конвертер LibreOffice, OCR или новый адаптер формата.',
        { format: version.detected_format });
      database.run(`
        UPDATE document_versions
        SET processing_status = 'needs_review', structure_status = 'unsupported',
          preview_status = 'unsupported'
        WHERE id = ?
      `, version.id);
      database.run("UPDATE documents SET status = 'needs_review', updated_at = ? WHERE id = ?", new Date().toISOString(), version.document_id);
      database.run(`
        UPDATE extraction_runs SET extractor_code = 'unsupported', status = 'needs_review', completed_at = ?
        WHERE id = ?
      `, new Date().toISOString(), extractionRunId);
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

    const text = extracted.text;
    const blocks = Array.isArray(extracted.blocks) ? extracted.blocks : [];
    const ocr = extracted.diagnostics?.ocr || {
      status: 'not_needed',
      engine: null,
      languages: null,
      confidence: null,
      error: null,
      coverage: null
    };

    if (payload.reprocess) resolvePreviousRecognitionReviews(database, version, extractionRunId);

    if (!text) {
      insertReview(database, version.workspace_id, version.id, 'empty_text',
        'В документе не найден текст',
        'Файл сохранён, но текстовый слой и результат OCR пусты.',
        'Проверьте качество скана или загрузите документ с текстовым слоем.',
        { format: version.detected_format, ocr });
    }
    ocrReview(database, version, ocr);
    const recognitionNeedsReview = ['unavailable', 'failed', 'empty', 'disabled', 'partial'].includes(ocr.status);

    const requestedProtocol = payload.requestedType === 'protocol';
    const isProtocol = requestedProtocol || (Boolean(text) && looksLikeDepartmentProtocol(text));
    const protocolResult = isProtocol ? extractDepartmentProtocol(text || '') : null;
    const requestedDirective = ['directive', 'order', 'decree'].includes(payload.requestedType);
    const isDirective = Boolean(text) && !isProtocol && (requestedDirective || looksLikeDirective(text));
    const directiveResult = isDirective
      ? extractDirective(text, { requestedType: requestedDirective ? payload.requestedType : null })
      : null;
    const llmResult = isDirective
      ? await proposeDirectiveWithLlama({ config, text, deterministic: directiveResult })
      : null;
    const requestedPlan = [
      'plan', 'department_plan', 'faculty_plan', 'personal_plan', 'unit_plan', 'organization_plan'
    ].includes(payload.requestedType);
    const isPlan = Boolean(text) && !isProtocol && !isDirective
      && (requestedPlan || looksLikePlan(text, blocks, version.title));
    const planResult = isPlan ? extractPlan({
      text, blocks, title: version.title, requestedType: payload.requestedType
    }) : null;
    const requestedScience = ['article','conference','grant','patent','project','nir_report','science'].includes(payload.requestedType);
    const isScientific = Boolean(text) && !isProtocol && !isDirective && !isPlan
      && (requestedScience || looksLikeScientificMaterial(text, version.title));
    const scienceResult = isScientific ? extractScientificMaterial(text, version.title) : null;
    let templateApplications = [];
    let persistedProtocolId = null;
    let persistedDirective = null;
    let persistedPlan = null;
    let persistedScience = null;
    let finalType = isProtocol ? 'department_protocol'
      : isDirective ? directiveResult.kind
        : isPlan ? planResult.documentType
          : isScientific ? scienceResult.kind : 'unknown';
    let finalStatus = isPlan
      ? (planResult.requiresReview ? 'needs_review' : 'processed')
      : (isProtocol || isDirective || isScientific ? 'processed' : 'needs_review');
    let confidence = protocolResult?.confidence ?? directiveResult?.confidence ?? planResult?.confidence ?? scienceResult?.confidence ?? null;
    let extractorCode = isProtocol ? 'department-protocol'
      : isDirective ? 'directive-deterministic'
        : isPlan ? 'plan-deterministic'
          : isScientific ? 'science-deterministic' : extracted.extractor;
    let extractorVersion = isProtocol ? '1' : isDirective ? '2' : isPlan ? '1' : isScientific ? '1' : extracted.version;
    const completedAt = new Date().toISOString();

    database.transaction(() => {
      persistPreviewBlob(database, preview, completedAt);
      replaceDocumentBlocks(database, {
        documentVersionId: version.id,
        blocks,
        extractor: extracted.extractor,
        version: extracted.version
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

      if (isProtocol) {
        persistedProtocolId = persistProtocol(database, {
          workspaceId: version.workspace_id,
          documentVersionId: version.id,
          documentTitle: version.title,
          result: protocolResult
        });
        const importYear = protocolImportYear(version.upload_key);
        protocolResult.importYear = importYear;
        if (importYear && protocolResult.meetingDate && !protocolResult.meetingDate.startsWith(`${importYear}-`)) {
          insertReview(database, version.workspace_id, version.id, 'protocol_year_mismatch',
            'Дата протокола не совпадает с выбранным годом',
            `Для загрузки выбран ${importYear} год, а в документе найдена дата ${protocolResult.meetingDate}.`,
            'Проверьте дату в исходнике и исправьте её в карточке заседания либо загрузите файл в нужный год.',
            { meetingId: persistedProtocolId, importYear, meetingDate: protocolResult.meetingDate });
        }
        protocolResult.reviewCount = openReviewCount(database, version.workspace_id, version.id);
        finalStatus = protocolResult.reviewCount > 0 ? 'needs_review' : 'processed';
      } else if (isDirective) {
        persistedDirective = persistDirective(database, {
          workspaceId: version.workspace_id,
          documentVersionId: version.id,
          documentTitle: version.title,
          result: directiveResult
        });
        if (llmResult) {
          recordLlmRun(database, version.workspace_id, version.id, llmResult, completedAt);
          if (llmResult.status === 'completed') {
            insertReview(database, version.workspace_id, version.id, 'llm_directive_proposal',
              'Локальная модель предложила уточнения',
              'Детерминированный результат уже сохранён. Предложение LLM доступно только для проверки и не меняет подтверждённые сведения.',
              'Сравните предложение модели с исходным документом и примите только подтверждённые поля.',
              { directiveId: persistedDirective?.id, proposal: llmResult.output });
          }
        }
      } else if (isPlan) {
        persistedPlan = persistPlan(database, {
          workspaceId: version.workspace_id,
          documentVersionId: version.id,
          documentTitle: version.title,
          result: planResult,
          now: completedAt
        });
      } else if (isScientific) {
        persistedScience = persistScientificItem(database, {
          workspaceId: version.workspace_id,
          documentVersionId: version.id,
          documentTitle: version.title,
          result: scienceResult,
          now: completedAt
        });
      } else if (text) {
        templateApplications = applyMatchingTemplates(database, {
          workspaceId: version.workspace_id,
          version,
          text,
          blocks
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
            'Откройте документ и создайте шаблон из структурного фрагмента.');
        }
      }

      if (recognitionNeedsReview) finalStatus = 'needs_review';

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
        UPDATE documents
        SET document_type = ?, status = ?, updated_at = ?
        WHERE id = ?
      `, finalType, finalStatus, completedAt, version.document_id);
      database.run(`
        UPDATE extraction_runs
        SET extractor_code = ?, extractor_version = ?, status = ?, confidence = ?, result_json = ?, completed_at = ?
        WHERE id = ?
      `, extractorCode, extractorVersion,
      finalStatus === 'processed' ? 'completed' : 'needs_review', confidence,
      JSON.stringify({
        textExtractor: { code: extracted.extractor, version: extracted.version },
        ocr,
        preview: {
          status: preview.status,
          mediaType: preview.mediaType,
          error: preview.error
        },
        protocol: protocolResult,
        directive: directiveResult ? {
          id: persistedDirective?.id || null,
          kind: directiveResult.kind,
          documentNumber: directiveResult.documentNumber,
          assignmentCount: directiveResult.assignments.length
        } : null,
        plan: planResult ? {
          id: persistedPlan?.id || null,
          kind: planResult.kind,
          periodKind: planResult.periodKind,
          periodKey: planResult.periodKey,
          itemCount: planResult.items.length,
          warnings: planResult.warnings
        } : null,
        llm: llmResult ? {
          status: llmResult.status,
          model: llmResult.model || null,
          promptVersion: llmResult.promptVersion || null,
          error: llmResult.error || null
        } : null,
        science: scienceResult ? {
          id: persistedScience?.id || null,
          kind: scienceResult.kind,
          doi: scienceResult.doi,
          authorCount: scienceResult.authors.length
        } : null,
        templates: templateApplications.map(({ template, result }) => ({
          id: template.id,
          code: template.code,
          confidence: result.confidence,
          missing: result.missing
        }))
      }),
      completedAt, extractionRunId);
    });
    const reportMatches = text && !isProtocol && !isDirective && !isPlan
      ? generateReportMatchCandidates(database, version.workspace_id, version.id, completedAt)
      : [];
    logger.info('document processed', {
      documentId: version.document_id,
      versionId: version.id,
      format: version.detected_format,
      type: finalType,
      status: finalStatus,
      meetingId: persistedProtocolId,
      templates: templateApplications.length,
      reportMatches: reportMatches.length,
      planId: persistedPlan?.id || null,
      scientificItemId: persistedScience?.id || null,
      ocrStatus: ocr.status,
      previewStatus: preview.status
    });
  } catch (error) {
    database.run(`
      UPDATE document_versions
      SET processing_status = 'failed', extraction_error = ?, structure_status = 'failed',
        preview_status = 'failed', preview_error = ?
      WHERE id = ?
    `, String(error?.message || error), String(error?.message || error), version.id);
    database.run("UPDATE documents SET status = 'failed', updated_at = ? WHERE id = ?", new Date().toISOString(), version.document_id);
    database.run(`
      UPDATE extraction_runs
      SET status = 'failed', error_code = ?, error_message = ?, completed_at = ?
      WHERE id = ?
    `, error.code || 'processing_failed', String(error?.message || error), new Date().toISOString(), extractionRunId);
    throw error;
  }
}

export async function dispatchJob(database, job, logger, config) {
  const payload = JSON.parse(job.payload_json);
  switch (job.kind) {
    case 'process_document':
      return processDocumentJob(database, payload, logger, config);
    default:
      throw new Error(`Unsupported job kind: ${job.kind}`);
  }
}
