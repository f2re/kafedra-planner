import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const run = promisify(execFile);

test('verifier отклоняет symlink до распаковки release-архива', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-release-security-'));
  try {
    const bundle = join(root, 'kafedra-malicious');
    await mkdir(bundle, { recursive: true });
    await symlink('/tmp', join(bundle, 'outside'));
    const archive = join(root, 'malicious.tar.gz');
    await run('tar', ['-C', root, '-czf', archive, 'kafedra-malicious']);
    await assert.rejects(
      () => run('bash', [resolve('scripts/offline/verify-bundle.sh'), archive]),
      (error) => /Неподдерживаемый тип записи в release-архиве/u.test(`${error.stderr || ''}${error.stdout || ''}`)
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
