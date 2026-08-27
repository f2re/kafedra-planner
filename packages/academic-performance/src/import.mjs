import { newId } from '../../core/src/ids.mjs';
import { columnLetters, findTable, readGradeTables } from './parser.mjs';
import {
  academicYear,
  fail,
  hash,
  normalizedGroup,
  semester,
  source,
  text,
  validateProfile,
  validateSource
} from './shared.mjs';
import {
  ensureDiscipline,
  ensureGroup,
  ensurePeriod
} from './repository.mjs';
import { processAcademicImportRows } from './import-rows.mjs';
import { runRow } from './reports.mjs';

function finishFailed(database, runId, error) {
  const failedAt = new Date().toISOString();
  database.run(`
    UPDATE academic_grade_imports
    SET status = 'failed', error_message = ?, updated_at = ?, completed_at = ?
    WHERE id = ?
  `, String(error?.code || error?.message || error), failedAt, failedAt, runId);
}

export async function importAcademicPerformance(
  database,
  workspaceId,
  input = {},
  actorPersonId = null
) {
  const item = source(database, workspaceId, input.documentId);
  validateSource(item);
  const profile = validateProfile(input.profile);
  const groupCode = text(input.groupCode, 200);
  if (!groupCode) fail('academic_group_required');
  const year = academicYear(input.academicYear);
  const semesterNo = semester(input.semester);
  const idempotencyKey = text(input.idempotencyKey, 300);
  if (!idempotencyKey) fail('academic_grade_idempotency_required');

  const profileHash = hash(profile);
  const requestHash = hash({
    sourceDocumentVersionId: item.version_id,
    groupCode: normalizedGroup(groupCode),
    academicYear: year,
    semester: semesterNo,
    profile
  });
  const existingByKey = database.get(`
    SELECT id, request_hash FROM academic_grade_imports
    WHERE workspace_id = ? AND idempotency_key = ?
  `, workspaceId, idempotencyKey);
  if (existingByKey) {
    if (existingByKey.request_hash !== requestHash) {
      fail('academic_grade_idempotency_conflict', { importId: existingByKey.id });
    }
    return runRow(database, workspaceId, existingByKey.id);
  }

  const tables = await readGradeTables(database, item);
  const table = findTable(tables, profile.sheetName);
  if (!table) fail('academic_grade_sheet_not_found', { sheetName: profile.sheetName });
  const header = table.rows.get(profile.headerRow);
  if (!header) fail('academic_grade_header_not_found', { headerRow: profile.headerRow });
  if (!header.get(profile.studentColumn)) fail('academic_grade_student_header_not_found');
  for (const discipline of profile.disciplines) {
    if (!header.get(discipline.column)) {
      fail('academic_grade_discipline_header_not_found', { column: discipline.column });
    }
  }

  const now = new Date().toISOString();
  let runId;
  let group;
  let period;
  let createdRun = false;
  database.transaction(() => {
    group = ensureGroup(database, workspaceId, groupCode, now);
    period = ensurePeriod(database, workspaceId, year, semesterNo, now);
    const equivalent = database.get(`
      SELECT id, request_hash FROM academic_grade_imports
      WHERE workspace_id = ? AND source_document_version_id = ? AND group_id = ?
        AND period_id = ? AND profile_hash = ?
    `, workspaceId, item.version_id, group.id, period.id, profileHash);
    if (equivalent) {
      if (equivalent.request_hash !== requestHash) {
        fail('academic_grade_import_conflict', { importId: equivalent.id });
      }
      runId = equivalent.id;
      return;
    }

    runId = newId('acimport');
    createdRun = true;
    database.run(`
      INSERT INTO academic_grade_imports(
        id, workspace_id, source_document_version_id, source_name, group_id, period_id,
        idempotency_key, request_hash, profile_hash, status, profile_json,
        discipline_count, created_by_person_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)
    `, runId, workspaceId, item.version_id, item.original_name, group.id, period.id,
    idempotencyKey, requestHash, profileHash, JSON.stringify(profile),
    profile.disciplines.length, actorPersonId, now, now);
  });
  if (!createdRun) return runRow(database, workspaceId, runId);

  const disciplines = new Map();
  try {
    database.transaction(() => {
      for (const discipline of profile.disciplines) {
        const entity = ensureDiscipline(database, workspaceId, discipline.name, now);
        disciplines.set(discipline.column, entity);
        database.run(`
          INSERT INTO academic_grade_import_disciplines(
            id, import_id, discipline_id, source_column, source_name,
            source_header_cell, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, newId('acrundisc'), runId, entity.id, discipline.column, discipline.name,
        header.get(discipline.column)?.cell
          || `${columnLetters(discipline.column)}${profile.headerRow}`,
        now);
      }
    });

    processAcademicImportRows(database, {
      workspaceId,
      item,
      profile,
      table,
      group,
      period,
      disciplines,
      runId,
      now
    });
  } catch (error) {
    finishFailed(database, runId, error);
    throw error;
  }
  return runRow(database, workspaceId, runId);
}
