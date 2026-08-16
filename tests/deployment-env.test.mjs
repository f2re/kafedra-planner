import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const HELPER = join(ROOT, 'scripts/offline/environment-file.sh');

test('installer EnvironmentFile parser keeps shell syntax literal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kafedra-env-'));
  const config = join(directory, 'kafedra.env');
  const marker = join(directory, 'must-not-exist');
  try {
    await writeFile(config, [
      '# комментарий',
      'KAFEDRA_PORT=18080',
      `KAFEDRA_SMTP_PASSWORD=$(touch ${marker})`,
      "KAFEDRA_SMTP_FROM='Кафедра #1 <mail@example.test>'",
      'KAFEDRA_TELEGRAM_BOT_TOKEN=token;with#special$(echo no)`echo no`',
      'KAFEDRA_NOTIFICATION_DEFAULT_TIMEZONE="Europe/Moscow"',
      '',
    ].join('\n'), 'utf8');

    const output = execFileSync('bash', ['-c', [
      'set -Eeuo pipefail',
      'source "$1"',
      'kafedra_read_environment_file "$2"',
      'printf "%s\\n%s\\n%s\\n%s\\n" "$KAFEDRA_PORT" "$KAFEDRA_SMTP_PASSWORD" "$KAFEDRA_SMTP_FROM" "$KAFEDRA_TELEGRAM_BOT_TOKEN"',
    ].join('; '), 'bash', HELPER, config], { encoding: 'utf8' });

    assert.deepEqual(output.trimEnd().split('\n'), [
      '18080',
      `$(touch ${marker})`,
      'Кафедра #1 <mail@example.test>',
      'token;with#special$(echo no)`echo no`',
    ]);
    await assert.rejects(readFile(marker));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('installer EnvironmentFile parser rejects ambiguous or foreign assignments', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kafedra-env-invalid-'));
  try {
    for (const [name, body] of [
      ['duplicate', 'KAFEDRA_PORT=8080\nKAFEDRA_PORT=8081\n'],
      ['foreign', 'PATH=/tmp\n'],
      ['syntax', 'KAFEDRA_PORT 8080\n'],
      ['quote', 'KAFEDRA_SMTP_PASSWORD="unfinished\n'],
    ]) {
      const config = join(directory, `${name}.env`);
      await writeFile(config, body, 'utf8');
      const result = spawnSync('bash', ['-c', 'set -Eeuo pipefail; source "$1"; kafedra_read_environment_file "$2"', 'bash', HELPER, config], { encoding: 'utf8' });
      assert.notEqual(result.status, 0, `${name} must be rejected`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
