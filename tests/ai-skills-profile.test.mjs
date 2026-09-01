import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_SKILLS,
  PROFILE_MANIFEST,
  REQUIRED_MARKERS,
  ROLE_HANDOFF_MARKERS,
  validateKafedraAiSkillsProfile
} from '../scripts/ai-skills-profile-check.mjs';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function localSkillPath(name) {
  return `codex/skills/${name}/SKILL.md`;
}

const FIXTURE_FILES = [...new Set([
  PROFILE_MANIFEST,
  ...Object.keys(EXPECTED_SKILLS).map(localSkillPath),
  ...Object.keys(REQUIRED_MARKERS),
  ...Object.keys(ROLE_HANDOFF_MARKERS)
])];

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-ai-skills-profile-'));
  for (const relativePath of FIXTURE_FILES) {
    const source = join(PROJECT_ROOT, relativePath);
    const target = join(root, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target);
  }
  return root;
}

test('pinned Kafedra AI skills profile validates in the repository', async () => {
  const errors = await validateKafedraAiSkillsProfile({ root: PROJECT_ROOT });
  assert.deepEqual(errors, []);
});

test('validator rejects byte drift in a vendored skill', async (t) => {
  const root = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const skillPath = join(root, localSkillPath('kafedra-document-intake'));
  const original = await readFile(skillPath, 'utf8');
  await writeFile(skillPath, `${original}\n<!-- drift -->\n`, 'utf8');

  const errors = await validateKafedraAiSkillsProfile({ root });
  assert.ok(errors.some((error) => error.includes('kafedra-document-intake/SKILL.md') && error.includes('Git blob SHA')));
});

test('validator rejects source and routing drift', async (t) => {
  const root = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const manifestPath = join(root, PROFILE_MANIFEST);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.source.commit = '0000000000000000000000000000000000000000';
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const agentsPath = join(root, 'AGENTS.md');
  const agents = await readFile(agentsPath, 'utf8');
  await writeFile(agentsPath, agents.replace('Обязательный Kafedra workspace preflight', 'Kafedra workspace route'), 'utf8');

  const rolePath = join(root, 'codex/skills/kafedra-flow-intake/SKILL.md');
  const role = await readFile(rolePath, 'utf8');
  await writeFile(rolePath, role.replace('Kafedra profile handoff:', 'Kafedra profile route:'), 'utf8');

  const errors = await validateKafedraAiSkillsProfile({ root });
  assert.ok(errors.some((error) => error.includes('source.commit')));
  assert.ok(errors.some((error) => error.includes('AGENTS.md') && error.includes('Обязательный Kafedra workspace preflight')));
  assert.ok(errors.some((error) => error.includes('kafedra-flow-intake/SKILL.md') && error.includes('Kafedra profile handoff:')));
});
