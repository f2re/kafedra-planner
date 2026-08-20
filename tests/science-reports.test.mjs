import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { createScientificItem } from '../packages/science/src/service.mjs';
import { createOrganizationUnit, createPersonAppointment, organizationSnapshot } from '../packages/organization/src/service.mjs';
import { generateScienceReport, scienceReportData } from '../packages/science-reports/src/service.mjs';
import { writeZipArchive, readZipArchive } from '../packages/plan-docx/src/archive.mjs';

const migrationsDir = resolve('migrations');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-science-reports-'));
  const blobDir = join(root, 'blobs');
  const tempDir = join(root, 'tmp');
  await mkdir(blobDir, { recursive: true });
  await mkdir(tempDir, { recursive: true });
  const database = new Database(join(root, 'database.sqlite3'), { migrationsDir });
  const workspace = ensureDefaultWorkspace(database);
  return { root, blobDir, tempDir, database, workspace, config: { blobDir, tempDir } };
}

async function closeFixture(env) {
  env.database.close();
  await rm(env.root, { recursive: true, force: true });
}

async function addTemplate(database, workspaceId, env, id, documentXml) {
  const path = join(env.root, `${id}.docx`);
  await writeZipArchive(path, {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': documentXml
  });
  const bytes = await readFile(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const stored = join(env.blobDir, sha256);
  await writeFile(stored, bytes);
  const now = new Date().toISOString();
  database.run('INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES (?,?,?,?,?)',
    sha256, bytes.length, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', stored, now);
  database.run(`INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at) VALUES (?,?,?,'template','processed',?,?,?)`,
    id, workspaceId, id, `${id}_version`, now, now);
  database.run(`
    INSERT INTO document_versions(
      id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,processing_status,uploaded_at
    ) VALUES (?,?,1,?,?,'application/vnd.openxmlformats-officedocument.wordprocessingml.document','docx','processed',?)
  `, `${id}_version`, id, sha256, `${id}.docx`, now);
  return { id, versionId: `${id}_version`, path: stored, sha256 };
}

async function seed(env) {
  const { database, workspace } = env;
  const actor = createPerson(database, workspace.id, { displayName: 'Руководитель Науки' });
  const author = createPerson(database, workspace.id, { displayName: 'Автор Отчёта' });
  const rootUnit = organizationSnapshot(database, workspace.id, { includeInactive: true }).tree[0];
  const unit = createOrganizationUnit(database, workspace.id, {
    name: 'Лаборатория отчётности', unitKind: 'laboratory', parentUnitId: rootUnit.id,
    validFrom: '2020-01-01'
  }, actor.id);
  createPersonAppointment(database, workspace.id, author.id, { unitId: unit.id, validFrom: '2020-01-01' }, actor.id);
  const article = createScientificItem(database, workspace.id, {
    title: 'Статья для научного отчёта', kind: 'article', authors: ['Автор Отчёта'],
    publicationYear: 2026, doi: '10.1000/report', venue: 'Журнал Наука', classifications: ['ВАК','РИНЦ']
  });
  const conference = createScientificItem(database, workspace.id, {
    title: 'Доклад для научного отчёта', kind: 'conference', authors: ['Автор Отчёта'],
    publicationYear: 2025, venue: 'Конференция', classifications: ['РИНЦ']
  });
  return { actor, author, unit, article, conference };
}

test('предпросмотр фильтрует по подразделению, периоду и классификации', async () => {
  const env = await fixture();
  try {
    const seeded = await seed(env);
    const data = scienceReportData(env.database, env.workspace.id, {
      unitId: seeded.unit.id, yearFrom: 2026, yearTo: 2026, classification: 'ВАК'
    }, ['title','year','authors','unit','evidence']);
    assert.equal(data.rows.length, 1);
    assert.equal(data.rows[0].title, 'Статья для научного отчёта');
    assert.equal(data.rows[0].unit, 'Лаборатория отчётности');
    assert.equal(data.summary.total, 1);
    assert.equal(data.summary.uniqueAuthors, 1);
  } finally {
    await closeFixture(env);
  }
});

test('CSV и встроенный DOCX регистрируются как документы и повтор не создаёт копию', async () => {
  const env = await fixture();
  try {
    const seeded = await seed(env);
    const csv = await generateScienceReport(env.database, env.workspace.id, {
      title: 'CSV научной деятельности', format: 'csv',
      filters: { yearFrom: 2025, yearTo: 2026 }, fields: ['title','kind','year','authors','doi'],
      idempotencyKey: 'science-report-csv'
    }, env.config, seeded.actor.id);
    assert.equal(csv.status, 'completed');
    assert.equal(csv.row_count, 2);
    const csvPath = env.database.get(`
      SELECT fb.storage_path FROM document_versions dv JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
      WHERE dv.id = ?
    `, csv.generated_document_version_id).storage_path;
    const csvText = await readFile(csvPath, 'utf8');
    assert.match(csvText, /Статья для научного отчёта/u);
    assert.match(csvText, /10\.1000\/report/u);

    const repeated = await generateScienceReport(env.database, env.workspace.id, {
      title: 'CSV научной деятельности', format: 'csv',
      filters: { yearFrom: 2025, yearTo: 2026 }, fields: ['title','kind','year','authors','doi'],
      idempotencyKey: 'science-report-csv'
    }, env.config, seeded.actor.id);
    assert.equal(repeated.generated_document_id, csv.generated_document_id);
    assert.equal(repeated.duplicateRequest, true);

    const docx = await generateScienceReport(env.database, env.workspace.id, {
      title: 'DOCX научной деятельности', format: 'docx',
      filters: { yearFrom: 2026, yearTo: 2026 }, fields: ['title','authors','unit','classifications'],
      idempotencyKey: 'science-report-docx'
    }, env.config, seeded.actor.id);
    const docxPath = env.database.get(`
      SELECT fb.storage_path FROM document_versions dv JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256 WHERE dv.id = ?
    `, docx.generated_document_version_id).storage_path;
    const archive = await readZipArchive(docxPath);
    const xml = archive.get('word/document.xml').toString('utf8');
    assert.match(xml, /DOCX научной деятельности/u);
    assert.match(xml, /Статья для научного отчёта/u);
    assert.equal(env.database.get('SELECT COUNT(*) AS n FROM science_report_runs').n, 2);
    assert.deepEqual(env.database.foreignKeyCheck(), []);
  } finally {
    await closeFixture(env);
  }
});

test('пользовательский DOCX-образец остаётся неизменным', async () => {
  const env = await fixture();
  try {
    const seeded = await seed(env);
    const templateXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>{{SCIENCE_TITLE}}</w:t></w:r></w:p>
<w:p><w:r><w:t>{{SCIENCE_PERIOD}}</w:t></w:r></w:p>
<w:p><w:r><w:t>{{SCIENCE_TABLE}}</w:t></w:r></w:p>
<w:p><w:r><w:t>Количество: {{SCIENCE_COUNT}}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`;
    const template = await addTemplate(env.database, env.workspace.id, env, 'science_template', templateXml);
    const before = await readFile(template.path);
    const report = await generateScienceReport(env.database, env.workspace.id, {
      title: 'Отчёт по образцу', format: 'docx', templateDocumentId: template.id,
      filters: { yearFrom: 2026, yearTo: 2026 }, fields: ['title','year','authors'],
      idempotencyKey: 'science-report-template'
    }, env.config, seeded.actor.id);
    const after = await readFile(template.path);
    assert.deepEqual(after, before);
    const outputPath = env.database.get(`
      SELECT fb.storage_path FROM document_versions dv JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256 WHERE dv.id = ?
    `, report.generated_document_version_id).storage_path;
    const xml = (await readZipArchive(outputPath)).get('word/document.xml').toString('utf8');
    assert.match(xml, /Отчёт по образцу/u);
    assert.match(xml, /Статья для научного отчёта/u);
    assert.doesNotMatch(xml, /\{\{SCIENCE_TABLE\}\}/u);
    assert.equal(env.database.get('SELECT blob_sha256 FROM document_versions WHERE id = ?', template.versionId).blob_sha256, template.sha256);
  } finally {
    await closeFixture(env);
  }
});
