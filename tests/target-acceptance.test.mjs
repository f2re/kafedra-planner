import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import {
  collectAcceptanceEvidence,
  compareAcceptanceEvidence
} from '../packages/system/src/acceptance.mjs';

const migrationsDir = resolve('migrations');

function fullPreflight() {
  return {
    status: 'ready',
    requiredMissing: [],
    optionalMissing: [],
    capabilities: {
      backup: true, serviceInstall: true, officeExtract: true, pdfText: true,
      ocr: true, officePreview: true, reverseProxy: true
    },
    checks: [{ id: 'libreoffice', available: true, command: 'soffice' }]
  };
}

function fakeRunner(command, args) {
  if (command === 'systemctl') {
    const service = args[1];
    return {
      ok: true,
      status: 0,
      stdout: [
        'ActiveState=active', 'SubState=running', 'User=kafedra-planner', 'Group=kafedra-planner',
        'NoNewPrivileges=yes', 'PrivateTmp=yes', 'ProtectSystem=strict', 'ProtectHome=yes',
        'ReadWritePaths=/var/lib/kafedra-planner', 'UMask=0077',
        `FragmentPath=/etc/systemd/system/${service}`, 'MainPID=123', 'ExecMainStatus=0'
      ].join('\n'),
      stderr: '', error: null
    };
  }
  return { ok: true, status: 0, stdout: `${command} test-version`, stderr: '', error: null };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-target-acceptance-'));
  const dataDir = join(root, 'data');
  const blobDir = join(dataDir, 'blobs');
  const backupDir = join(root, 'backups');
  const applicationDir = join(root, 'application');
  const databasePath = join(dataDir, 'kafedra-planner.sqlite3');
  await mkdir(blobDir, { recursive: true });
  await mkdir(backupDir, { recursive: true });
  await mkdir(applicationDir, { recursive: true });
  await writeFile(join(applicationDir, 'VERSION'), '0.1.0-rc.3\n');
  const backupPath = join(backupDir, 'kafedra-test.kpb');
  await writeFile(backupPath, 'encrypted-backup-fixture');
  await writeFile(join(backupDir, 'latest-success.json'), JSON.stringify({
    archivePath: backupPath,
    archiveName: 'kafedra-test.kpb', createdAt: '2026-08-07T12:00:00.000Z',
    verifiedAt: '2026-08-07T12:01:00.000Z', schemaVersion: 20,
    appVersion: '0.1.0-rc.3', encrypted: true
  }));

  const database = new Database(databasePath, { migrationsDir });
  const workspace = ensureDefaultWorkspace(database);
  const bytes = Buffer.from('immutable-evidence');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const blobPath = join(blobDir, sha256);
  await writeFile(blobPath, bytes);
  database.run(`
    INSERT INTO file_blobs(sha256, size_bytes, media_type, storage_path, created_at)
    VALUES (?, ?, 'application/octet-stream', ?, '2026-08-07T12:00:00.000Z')
  `, sha256, bytes.length, blobPath);
  database.run(`
    INSERT INTO documents(id, workspace_id, title, status, created_at, updated_at)
    VALUES ('acceptance-doc', ?, 'Контрольный документ', 'processed', '2026-08-07T12:00:00.000Z', '2026-08-07T12:00:00.000Z')
  `, workspace.id);
  database.run(`
    INSERT INTO document_versions(
      id, document_id, version_no, blob_sha256, original_name, media_type,
      detected_format, processing_status, extracted_text, uploaded_at
    ) VALUES (
      'acceptance-version', 'acceptance-doc', 1, ?, 'acceptance.bin',
      'application/octet-stream', 'binary', 'processed', 'Контрольный документ',
      '2026-08-07T12:00:00.000Z'
    )
  `, sha256);
  database.run("UPDATE documents SET current_version_id = 'acceptance-version' WHERE id = 'acceptance-doc'");
  database.run(`
    INSERT INTO periodic_tasks(
      id, workspace_id, period_kind, period_key, title, due_date, direction,
      status, expected_result, report_required, created_at, updated_at
    ) VALUES (
      'acceptance-task', ?, 'semester', '2026-1', 'Контрольная задача',
      '2026-12-20', 'organizational', 'submitted', 'Подтверждённый отчёт', 1,
      '2026-08-07T12:00:00.000Z', '2026-08-07T12:00:00.000Z'
    )
  `, workspace.id);
  database.run(`
    INSERT INTO periodic_task_evidence(
      id, periodic_task_id, document_version_id, evidence_kind, note,
      locator_json, review_status, created_at
    ) VALUES (
      'acceptance-periodic-evidence', 'acceptance-task', 'acceptance-version',
      'report', 'Контрольный отчёт', '{}', 'pending', '2026-08-07T12:00:00.000Z'
    )
  `);
  database.close();
  return { root, dataDir, blobDir, backupDir, applicationDir, databasePath, blobPath, backupPath };
}

test('акт подтверждает SQLite, logical digest, immutable blobs, backup и systemd hardening без секретов', async () => {
  const item = await fixture();
  try {
    const evidence = await collectAcceptanceEvidence({
      databasePath: item.databasePath,
      dataDir: item.dataDir,
      backupDir: item.backupDir,
      applicationDir: item.applicationDir,
      requireFull: true,
      runner: fakeRunner,
      preflightResult: fullPreflight(),
      services: ['kafedra-planner-api.service', 'kafedra-planner-worker.service'],
      osReleasePath: join(item.root, 'missing-os-release')
    });
    assert.equal(evidence.formatVersion, 2);
    assert.equal(evidence.acceptance.status, 'pass');
    assert.equal(evidence.database.quickCheck, 'ok');
    assert.equal(evidence.database.schemaVersion, 20);
    assert.equal(evidence.database.missingStableTables.length, 0);
    assert.equal(evidence.database.stableTableCounts.documents, 1);
    assert.equal(evidence.database.stableTableCounts.periodic_task_evidence, 1);
    assert.match(evidence.database.stableDigest, /^[a-f0-9]{64}$/u);
    assert.match(evidence.database.stableTableDigests.documents, /^[a-f0-9]{64}$/u);
    assert.match(evidence.database.stableTableDigests.periodic_task_evidence, /^[a-f0-9]{64}$/u);
    assert.equal(evidence.database.blobs.count, 1);
    assert.equal(evidence.database.blobs.verified, 1);
    assert.equal(evidence.database.blobs.missing.length, 0);
    assert.equal(evidence.database.blobs.mismatched.length, 0);
    assert.equal(evidence.services.every((service) => service.hardened), true);
    assert.equal(evidence.backup.encrypted, true);
    assert.equal(evidence.backup.archivePresent, true);
    assert.equal(evidence.backup.archiveName, 'kafedra-test.kpb');
    assert.match(evidence.backup.archiveSha256, /^[a-f0-9]{64}$/u);
    const serialized = JSON.stringify(evidence);
    assert.equal(serialized.includes('SMTP_PASSWORD'), false);
    assert.equal(serialized.includes('TELEGRAM_BOT_TOKEN'), false);

    const equal = compareAcceptanceEvidence(evidence, structuredClone(evidence));
    assert.equal(equal.status, 'equal');
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('изменение данных при том же числе строк и повреждение blob выявляются независимо', async () => {
  const item = await fixture();
  try {
    const before = await collectAcceptanceEvidence({
      databasePath: item.databasePath,
      dataDir: item.dataDir,
      backupDir: item.backupDir,
      applicationDir: item.applicationDir,
      requireFull: true,
      runner: fakeRunner,
      preflightResult: fullPreflight(),
      services: ['kafedra-planner-api.service', 'kafedra-planner-worker.service'],
      osReleasePath: join(item.root, 'missing-os-release')
    });

    const database = new Database(item.databasePath);
    database.run("UPDATE documents SET title = 'Подменённый документ' WHERE id = 'acceptance-doc'");
    database.run("UPDATE periodic_task_evidence SET review_status = 'approved', reviewed_at = '2026-08-08T12:00:00.000Z' WHERE id = 'acceptance-periodic-evidence'");
    database.close();
    await writeFile(item.blobPath, 'tampered-evidence');

    const after = await collectAcceptanceEvidence({
      databasePath: item.databasePath,
      dataDir: item.dataDir,
      backupDir: item.backupDir,
      applicationDir: item.applicationDir,
      requireFull: true,
      runner: fakeRunner,
      preflightResult: fullPreflight(),
      services: ['kafedra-planner-api.service', 'kafedra-planner-worker.service'],
      osReleasePath: join(item.root, 'missing-os-release')
    });
    assert.equal(after.acceptance.status, 'fail');
    assert.equal(after.database.stableTableCounts.documents, before.database.stableTableCounts.documents);
    assert.notEqual(after.database.stableTableDigests.documents, before.database.stableTableDigests.documents);
    assert.notEqual(
      after.database.stableTableDigests.periodic_task_evidence,
      before.database.stableTableDigests.periodic_task_evidence
    );
    assert.equal(after.database.blobs.mismatched.length, 1);
    assert.ok(after.acceptance.failures.some((value) => value.startsWith('blob_mismatch:')));
    const comparison = compareAcceptanceEvidence(before, after);
    assert.equal(comparison.status, 'different');
    assert.ok(comparison.differences.some((entry) => entry.field === 'database.stableDigest'));
    assert.ok(comparison.differences.some((entry) => entry.field === 'database.blobs.digest'));
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('полная приёмка блокируется без проверенного зашифрованного архива', async () => {
  const item = await fixture();
  try {
    await rm(item.backupPath, { force: true });
    const evidence = await collectAcceptanceEvidence({
      databasePath: item.databasePath,
      dataDir: item.dataDir,
      backupDir: item.backupDir,
      applicationDir: item.applicationDir,
      requireFull: true,
      runner: fakeRunner,
      preflightResult: fullPreflight(),
      services: ['kafedra-planner-api.service', 'kafedra-planner-worker.service'],
      osReleasePath: join(item.root, 'missing-os-release')
    });
    assert.equal(evidence.acceptance.status, 'fail');
    assert.ok(evidence.acceptance.failures.includes('backup_missing'));
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});