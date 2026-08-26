import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { writeZipArchive } from '../packages/plan-docx/src/archive.mjs';
import { uploadMeetingTemplate, saveMeetingSettings } from '../packages/protocols/src/meeting-settings.mjs';
import { listMeetingTemplateCatalog } from '../packages/protocols/src/meeting-template-library.mjs';

const migrationsDir = resolve('migrations');

async function migrationsThrough(root, maxVersion) {
  const target = join(root, `migrations-${maxVersion}`);
  await mkdir(target, { recursive: true });
  for (const name of (await readdir(migrationsDir)).filter((item) => /^\d+_.*\.sql$/u.test(item)).sort()) {
    if (Number(name.match(/^(\d+)/u)?.[1] || 0) <= maxVersion) await copyFile(join(migrationsDir, name), join(target, basename(name)));
  }
  return target;
}

function templateXml(kind) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${kind}</w:t></w:r></w:p><w:p><w:r><w:t>Протокол № {{PROTOCOL_NUMBER}}</w:t></w:r></w:p><w:p><w:r><w:t>{{AGENDA}}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`;
}

async function createTemplate(path, kind) {
  await writeZipArchive(path, {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': templateXml(kind)
  });
}

test('обновление 28 → 29 сохраняет настройки и поднимает старые DOCX в библиотеку', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-meeting-template-library-migration-'));
  const path = join(root, 'database.sqlite3');
  const oldMigrations = await migrationsThrough(root, 28);
  const protocolPath = join(root, 'protocol.docx');
  const extractPath = join(root, 'extract.docx');
  const config = { blobDir: join(root, 'blobs'), tempDir: join(root, 'tmp'), maxUploadBytes: 20 * 1024 * 1024 };
  let database = new Database(path, { migrationsDir: oldMigrations });
  let workspace;
  let protocol;
  let extract;
  try {
    await createTemplate(protocolPath, 'ПРОТОКОЛ');
    await createTemplate(extractPath, 'ВЫПИСКА');
    workspace = ensureDefaultWorkspace(database);
    const chair = createPerson(database, workspace.id, { displayName: 'Председатель до миграции' });
    const secretary = createPerson(database, workspace.id, { displayName: 'Секретарь до миграции' });
    protocol = await uploadMeetingTemplate(database, config, workspace.id, createReadStream(protocolPath), { kind: 'protocol', originalName: 'Протокол старой формы.docx' });
    extract = await uploadMeetingTemplate(database, config, workspace.id, createReadStream(extractPath), { kind: 'extract', originalName: 'Выписка старой формы.docx' });
    saveMeetingSettings(database, workspace.id, {
      protocolTemplateVersionId: protocol.version_id,
      extractTemplateVersionId: extract.version_id,
      quorum: 4,
      chairpersonPersonId: chair.id,
      secretaryPersonId: secretary.id
    });
    assert.equal(database.getSchemaVersion(), 28);
  } finally {
    database.close();
  }

  database = new Database(path, { migrationsDir });
  try {
    assert.equal(database.getSchemaVersion(), 29);
    const items = listMeetingTemplateCatalog(database, workspace.id, { includeArchived: true });
    assert.equal(items.length, 2);
    const protocolEntry = items.find((item) => item.document_version_id === protocol.version_id);
    const extractEntry = items.find((item) => item.document_version_id === extract.version_id);
    assert.equal(protocolEntry.readiness, 'legacy_compatible');
    assert.equal(protocolEntry.is_default, 1);
    assert.equal(extractEntry.readiness, 'legacy_compatible');
    assert.equal(extractEntry.is_default, 1);
    const settings = database.get('SELECT quorum, protocol_template_version_id, extract_template_version_id FROM meeting_settings WHERE workspace_id = ?', workspace.id);
    assert.deepEqual(settings, {
      quorum: 4,
      protocol_template_version_id: protocol.version_id,
      extract_template_version_id: extract.version_id
    });
    assert.deepEqual(database.foreignKeyCheck(), []);
    assert.equal(database.quickCheck(), true);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
