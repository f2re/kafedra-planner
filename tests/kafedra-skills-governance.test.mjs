import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateKafedraSkillsProfile } from '../scripts/kafedra-skills-governance.mjs';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifestPath = 'codex/skills/kafedra-profile.manifest.json';
const routingFiles = [
  'AGENTS.md',
  'docs/CODEX_AGENTS.md',
  'docs/KAFEDRA_SKILLS_PROFILE.md',
  'codex/skills/kafedra-flow-intake/SKILL.md',
  'codex/skills/kafedra-design/SKILL.md',
  'codex/skills/kafedra-motion/SKILL.md',
  'codex/skills/kafedra-feature/SKILL.md',
  'codex/skills/kafedra-design-audit/SKILL.md',
  'codex/skills/kafedra-tests/SKILL.md',
];

async function copyIntoFixture(sourceRoot, fixtureRoot, relativePath) {
  const destination = join(fixtureRoot, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(sourceRoot, relativePath), destination);
}

async function buildFixture(t) {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'kafedra-skills-'));
  t.after(async () => rm(fixtureRoot, { recursive: true, force: true }));

  await copyIntoFixture(rootDir, fixtureRoot, manifestPath);
  const manifest = JSON.parse(await readFile(join(rootDir, manifestPath), 'utf8'));
  const files = new Set([
    ...manifest.skills.map((skill) => skill.localPath),
    ...routingFiles,
  ]);
  for (const path of files) await copyIntoFixture(rootDir, fixtureRoot, path);
  return fixtureRoot;
}

test('pinned Kafedra workspace profile and routing are intact', async () => {
  assert.deepEqual(await validateKafedraSkillsProfile(rootDir), []);
});

test('missing orchestrator skill fails closed', async (t) => {
  const fixture = await buildFixture(t);
  await unlink(join(fixture, 'codex/skills/kafedra-workspace-orchestrator/SKILL.md'));
  const errors = await validateKafedraSkillsProfile(fixture);
  assert.ok(errors.some((error) => error.includes('kafedra-workspace-orchestrator/SKILL.md')));
});

test('modified pinned skill bytes fail Git-blob provenance', async (t) => {
  const fixture = await buildFixture(t);
  const path = join(fixture, 'codex/skills/kafedra-document-intake/SKILL.md');
  const original = await readFile(path, 'utf8');
  await writeFile(path, `${original}\nmodified\n`);
  const errors = await validateKafedraSkillsProfile(fixture);
  assert.ok(errors.some((error) => error.includes('Git blob') && error.includes('kafedra-document-intake')));
});

test('removing mandatory orchestrator preflight marker fails routing', async (t) => {
  const fixture = await buildFixture(t);
  const path = join(fixture, 'AGENTS.md');
  const original = await readFile(path, 'utf8');
  const modified = original.replaceAll('обязательный preflight', 'profile preflight');
  assert.notEqual(modified, original);
  await writeFile(path, modified);
  const errors = await validateKafedraSkillsProfile(fixture);
  assert.ok(errors.some((error) => error.includes('AGENTS.md') && error.includes('обязательный preflight')));
});
