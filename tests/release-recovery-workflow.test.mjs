import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const text = (path) => readFile(path, 'utf8');
const count = (source, pattern) => [...source.matchAll(pattern)].length;

test('release builds every target once and verifies deployment before packaging or publication', async () => {
  const workflow = await text('.github/workflows/release.yml');
  const builder = await text('scripts/offline/build-release-targets.sh');
  const reference = await text('scripts/offline/reference-build.sh');
  const verifier = await text('scripts/offline/verify-release-targets.sh');
  assert.equal(count(workflow, /build-release-targets\.sh "\$OUT"/g), 1);
  assert.equal(count(workflow, /verify-release-targets\.sh "\$OUT"/g), 1);
  assert.equal(count(reference, /build-full-bundle\.sh/g), 1);
  assert.match(builder, /debian:12/u);
  assert.match(builder, /registry\.astralinux\.ru\/library\/astra\/ubi17:latest/u);
  assert.match(builder, /registry\.astralinux\.ru\/library\/astra\/ubi18:latest/u);
  assert.match(verifier, /KAFEDRA_SELFTEST_BASE_IMAGE="\$image"/u);

  const build = workflow.indexOf('build-release-targets.sh "$OUT"');
  const deploy = workflow.indexOf('verify-release-targets.sh "$OUT"');
  const projectControl = workflow.indexOf('project-control-package.py');
  const createRelease = workflow.indexOf('gh release create "$TAG"');
  assert.ok(build >= 0 && deploy > build, 'matching deployment self-test must follow target builds');
  assert.ok(projectControl > deploy, 'Project Control must be derived only after deployment verification');
  assert.ok(createRelease > projectControl, 'GitHub Release creation must follow artifact verification');
});

test('release deployment path reuses the same installer for install update rollback and cached repair evidence', async () => {
  const workflow = await text('.github/workflows/release.yml');
  const selftest = await text('scripts/offline/systemd-deploy-selftest.sh');
  assert.match(workflow, /Verify install, update and rollback of every same artifact/u);
  assert.match(selftest, /KAFEDRA_SELFTEST_BASE_IMAGE/u);
  assert.match(selftest, /run_installer\(\)/u);
  assert.ok(count(selftest, /^run_installer$/gm) >= 3, 'clean, repeat and legacy installs must run the same wrapper');
  assert.ok(selftest.includes('[[ "$FIRST_RELEASE" == "$SECOND_RELEASE" ]] ||'), 'repeat installation must retain the release identity');
  assert.ok(selftest.includes('[[ "$RELEASE_COUNT" == 1 ]] ||'), 'repeat installation must not create another release directory');
  assert.match(selftest, /Installer не откатился после принудительного сбоя llama-server/u);
  assert.match(selftest, /Rollback не вернул legacy current/u);
  assert.match(workflow, /gh release download "\$PREVIOUS_TAG"/u);
  assert.match(selftest, /ExecStartPre=\/usr\/bin\/test \/opt\/kafedra-planner\/current -ef/u);
  assert.match(selftest, /Rollback не вернул опубликованный release/u);
  assert.match(selftest, /\/var\/cache\/kafedra-planner\/os-packages/u);
  assert.match(selftest, /doctor\.sh --repair/u);
  assert.doesNotMatch(workflow, /gh workflow run/u);
  assert.doesNotMatch(workflow, /actions\/runs/u);
});

test('GRACE runs the heavy target bundle gate only for offline deployment risk', async () => {
  const grace = await text('.github/workflows/grace.yml');
  assert.match(grace, /M-OFFLINE-BUNDLE/u);
  assert.match(grace, /Build and verify every supported target bundle/u);
  assert.match(grace, /build-release-targets\.sh "\$OUT"/u);
  assert.match(grace, /verify-release-targets\.sh "\$OUT"/u);
  assert.match(grace, /needs: \[contract, database, deployment\]/u);
});

test('release stops if main changes before build or publication', async () => {
  const source = await text('.github/workflows/release.yml');
  assert.match(source, /Require exact current main before build/u);
  assert.match(source, /Require exact current main before publication/u);
  assert.ok(count(source, /git\/ref\/heads\/main/g) >= 3);
  assert.match(source, /публикация \$SOURCE_SHA запрещена/u);
});

test('previous published bundle accepts historical and current manifests without accepting tampering', async (t) => {
  const workflow = await text('.github/workflows/release.yml');
  const block = workflow.split('      - name: Download previous published bundle for real upgrade acceptance\n')[1]
    ?.split('      - name: Build target-specific full offline bundles once')[0];
  const script = block?.split('        run: |\n')[1]
    ?.replace(/^          /gm, '').replaceAll('${{ steps.release.outputs.tag }}', 'v1.0.1');
  assert.ok(script, 'execute the actual previous-release verification step');
  const root = await mkdtemp(join(tmpdir(), 'kafedra-previous-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'gh'), `#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$1" == api ]]; then
  case "$2" in
    */releases/latest) echo v1.0.0 ;;
    */compare/v1.0.0...*) echo ahead ;;
    *) exit 23 ;;
  esac
elif [[ "$1" == release && "$2" == download ]]; then
  while (($#)); do
    if [[ "$1" == --dir ]]; then cp "$FIXTURE_DIR/"* "$2/"; exit 0; fi
    shift
  done
  exit 24
else exit 25
fi
`, { mode: 0o755 });
  const archive = 'kafedra-planner-1.0.0-debian-12-amd64.tar.gz';
  const digest = (content) => createHash('sha256').update(content).digest('hex');
  for (const mode of ['historical', 'current', 'bad-archive', 'bad-wrapper', 'bad-companion', 'missing-entry']) {
    const fixture = join(root, mode);
    const runner = join(root, `${mode}-runner`);
    await mkdir(fixture);
    await mkdir(runner);
    const payloads = {
      [archive]: 'published archive fixture',
      'install-kafedra-planner.sh': '#!/usr/bin/env bash\nexit 0\n',
      'README-INSTALL.txt': 'Published install instructions\n'
    };
    const lines = [];
    for (const [name, content] of Object.entries(payloads)) {
      await writeFile(join(fixture, name), content);
      if (mode !== 'missing-entry' || name !== 'install-kafedra-planner.sh') {
        lines.push(`${digest(content)}  ${name}\n`);
      }
    }
    const companion = `${digest(mode === 'bad-companion' ? 'other archive' : payloads[archive])}  ${archive}\n`;
    await writeFile(join(fixture, `${archive}.sha256`), companion);
    if (mode === 'current') lines.push(`${digest(companion)}  ${archive}.sha256\n`);
    // Optional Project Control assets need not be downloaded for native upgrade.
    lines.push(`${digest('optional package')}  kafedra-planner-1.0.0-project-control.f2re.zip\n`);
    await writeFile(join(fixture, 'SHA256SUMS'), lines.join(''));
    if (mode === 'bad-archive') await writeFile(join(fixture, archive), 'tampered archive');
    if (mode === 'bad-wrapper') await writeFile(join(fixture, 'install-kafedra-planner.sh'), 'tampered wrapper');
    const envFile = join(runner, 'env');
    await writeFile(envFile, '');
    const result = spawnSync('bash', ['-s'], {
      input: script, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE_DIR: fixture,
        RUNNER_TEMP: runner, GITHUB_ENV: envFile, GITHUB_REPOSITORY: 'fixture/project',
        SOURCE_SHA: 'a'.repeat(40) }
    });
    assert.equal(result.error, undefined, mode);
    const accepted = mode === 'historical' || mode === 'current';
    assert.equal(result.status === 0, accepted, `${mode}: ${result.stderr}`);
    assert.equal((await readFile(envFile, 'utf8')).includes('KAFEDRA_PREVIOUS_RELEASE_DIR='), accepted, mode);
  }
});
