import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const run = promisify(execFile);
const verifier = resolve('scripts/offline/verify-bundle.sh');

test('verifier отклоняет symlink до распаковки release-архива', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-release-security-'));
  try {
    const bundle = join(root, 'kafedra-malicious');
    await mkdir(bundle, { recursive: true });
    await symlink('/tmp', join(bundle, 'outside'));
    const archive = join(root, 'malicious.tar.gz');
    await run('tar', ['-C', root, '-czf', archive, 'kafedra-malicious']);
    await assert.rejects(
      () => run('bash', [verifier, archive], { env: { ...process.env, REQUIRE_ARCHIVE_SHA256: 'false' } }),
      (error) => /Неподдерживаемый тип записи в release-архиве/u.test(`${error.stderr || ''}${error.stdout || ''}`)
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('verifier по умолчанию требует внешний SHA-256', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-release-checksum-'));
  try {
    const bundle = join(root, 'kafedra-empty');
    await mkdir(bundle, { recursive: true });
    await writeFile(join(bundle, 'placeholder'), 'x');
    const archive = join(root, 'without-checksum.tar.gz');
    await run('tar', ['-C', root, '-czf', archive, 'kafedra-empty']);
    await assert.rejects(
      () => run('bash', [verifier, archive]),
      (error) => /отсутствует without-checksum\.tar\.gz\.sha256/u.test(`${error.stderr || ''}${error.stdout || ''}`)
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
