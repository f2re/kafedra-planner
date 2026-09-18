import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const script = fileURLToPath(new URL('../scripts/offline/astra-runtime-selftest.sh', import.meta.url));

// Capture the exact script delivered through Docker stdin, not the source text.
// Real Astra package/runtime acceptance remains in the deployment gate.
async function capture(t, remoteStatus = 0) {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-astra-transport-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const out = join(root, 'out');
  await mkdir(bin);
  await mkdir(out);
  const archive = 'kafedra-planner-test-astra.tar.gz';
  const payload = Buffer.from('transport fixture');
  await writeFile(join(out, archive), payload);
  await writeFile(join(out, `${archive}.sha256`), `${createHash('sha256').update(payload).digest('hex')}  ${archive}\n`);
  await writeFile(join(bin, 'docker'), `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$CAPTURE_DIR/calls"
case "$1" in
  exec)
    if [[ "$2" == -i ]]; then
      cat > "$CAPTURE_DIR/remote.sh"
      exit "$REMOTE_STATUS"
    fi
    ;;
  logs) echo 'container diagnostic' >&2 ;;
esac
`, { mode: 0o755 });
  const result = spawnSync('bash', [script, out], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CAPTURE_DIR: root,
      REMOTE_STATUS: String(remoteStatus), KAFEDRA_SELFTEST_BASE_IMAGE: 'astra-test' }
  });
  return { result, root, calls: await readFile(join(root, 'calls'), 'utf8'),
    remote: await readFile(join(root, 'remote.sh'), 'utf8') };
}

test('Astra acceptance preserves remote quoting and overrides the UBI entrypoint offline', async (t) => {
  const { result, calls, remote, root } = await capture(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(calls, /run .*--network none --entrypoint \/bin\/sh astra-test/u);
  assert.match(calls, /cp .*\.tar\.gz\.sha256 /u);
  assert.match(calls, /exec -i .* bash -s -- kafedra-planner-test-astra\.tar\.gz/u);
  const syntax = spawnSync('bash', ['-n'], { input: remote, encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  const validator = remote.match(/<<'PY'\n([\s\S]*?)\nPY/u)?.[1];
  assert.ok(validator, 'JSON validation must reach the container unchanged');
  for (const [value, accepted] of [
    [{ status: 'ready' }, true],
    [{ status: 'blocked', controlOcr: { status: 'ready' } }, false],
    [{ controlOcr: { status: 'ready' } }, false]
  ]) {
    const jsonPath = join(root, 'doctor.json');
    await writeFile(jsonPath, JSON.stringify(value, null, 2));
    const check = spawnSync('python3', ['-c', validator, jsonPath], { encoding: 'utf8' });
    assert.equal(check.error, undefined);
    assert.equal(check.status === 0, accepted, check.stderr);
  }
  assert.match(remote, /--headless --convert-to pdf/u);
  assert.match(remote, /pdftotext \/tmp\/office-control\.pdf/u);
  assert.match(remote, /if \[\[ -n "\$AUDIT" \]\]; then/u);
});

test('Astra acceptance preserves a failing runtime status and reports diagnostics before cleanup', async (t) => {
  const { result, calls } = await capture(t, 17);
  assert.equal(result.status, 17);
  assert.match(result.stderr, /container diagnostic/u);
  assert.ok(calls.indexOf('logs ') < calls.indexOf('rm -f '));
  assert.doesNotMatch(result.stdout, /selftest: OK/u);
});
