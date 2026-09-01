import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXPECTED_REPOSITORY = 'f2re/ai-agents-skills';
export const EXPECTED_COMMIT = '2645ab8afd34963e80397981d582ea3b141db8e3';
export const EXPECTED_BASE_PATH = '.agents/skills';
export const PROFILE_MANIFEST = 'codex/skills/kafedra-profile.json';

export const EXPECTED_SKILLS = Object.freeze({
  'kafedra-workspace-orchestrator': 'aa5cdff00e6b518df57a45aff5e578a10b931f9c',
  'kafedra-document-workspace': '0c853c4d9a0abd5c54fea7953a301d59a3aaa5f8',
  'kafedra-document-intake': '2fd3199d55e5803c330586e8f47a488337cb8494',
  'kafedra-provenance-and-inspector': '2a2818bb5c2c1be7e14b7c1096a8b5c3d405e011',
  'kafedra-action-recomposition': 'caa94c7bea4b7fbceb0f384edc33c2f8a3dce3df',
  'kafedra-review-by-exception': '8d47f6eda68e57484159105af0050943361cb4b4',
  'kafedra-search-and-navigation': 'a0f5cb3303342308a619065698dc89264f6ff116',
  'kafedra-responsive-inspector': '8b863d0ba32ca9230567ed3ca451bd5d75ed816e',
  'kafedra-motion-continuity': 'cb350ffe7e5dec02ac397a9a1d3d5981a45d6d5b',
  'kafedra-states-and-recovery': 'fc0f83ed13999614d634e6c1d0602fb5099fb9b0',
  'kafedra-adaptive-controls': '9eeb78dc1149608db649a5040d2c7708563ae6f1',
  'kafedra-plan-calendar-continuity': '5c5aa08c0090455902722a1e9aef1c3377a5018c',
  'kafedra-template-and-structured-document-flow': '249828096577508af9f8aa1ca489d2a35fde3e4e',
  'kafedra-ux-acceptance': 'eeead5bbf0fde9eeb4d2829761bd72418324850d'
});

export const REQUIRED_MARKERS = Object.freeze({
  'AGENTS.md': [
    'Обязательный Kafedra workspace preflight',
    'codex/skills/kafedra-workspace-orchestrator/SKILL.md',
    'docs/AI_SKILLS_PROFILE.md'
  ],
  'docs/CODEX_AGENTS.md': [
    'Автоматический Kafedra profile preflight',
    'kafedra-workspace-orchestrator',
    'select minimum focused profile skills'
  ],
  'docs/AI_SKILLS_PROFILE.md': [
    EXPECTED_COMMIT,
    'Fail-closed verification',
    'Updating the snapshot'
  ],
  'scripts/check.mjs': [
    'validateKafedraAiSkillsProfile',
    'formatAiSkillsProfileErrors'
  ]
});

export const ROLE_HANDOFF_MARKERS = Object.freeze({
  'codex/skills/kafedra-flow-intake/SKILL.md': ['Kafedra profile handoff:', 'kafedra-document-intake'],
  'codex/skills/kafedra-design/SKILL.md': ['Kafedra profile handoff:', 'kafedra-document-workspace'],
  'codex/skills/kafedra-motion/SKILL.md': ['Kafedra profile handoff:', 'kafedra-motion-continuity'],
  'codex/skills/kafedra-data/SKILL.md': ['Kafedra profile handoff:', 'kafedra-provenance-and-inspector'],
  'codex/skills/kafedra-feature/SKILL.md': ['Kafedra profile handoff:', 'kafedra-states-and-recovery'],
  'codex/skills/kafedra-design-audit/SKILL.md': ['Kafedra profile handoff:', 'kafedra-ux-acceptance'],
  'codex/skills/kafedra-tests/SKILL.md': ['Kafedra profile handoff:', 'kafedra-ux-acceptance'],
  'codex/skills/kafedra-release/SKILL.md': ['Kafedra profile handoff:', 'kafedra-states-and-recovery']
});

export function gitBlobSha(content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const header = Buffer.from(`blob ${buffer.length}\0`);
  return createHash('sha1').update(header).update(buffer).digest('hex');
}

async function readRequired(root, relativePath, errors) {
  try {
    return await readFile(join(root, relativePath));
  } catch (error) {
    errors.push(`${relativePath}: файл отсутствует или не читается (${error.code ?? error.message})`);
    return null;
  }
}

function expectedLocalPath(name) {
  return `codex/skills/${name}/SKILL.md`;
}

function expectedUpstreamPath(name) {
  return `${EXPECTED_BASE_PATH}/${name}/SKILL.md`;
}

function checkMarkers(relativePath, content, markers, errors) {
  if (!content) return;
  const text = content.toString('utf8');
  for (const marker of markers) {
    if (!text.includes(marker)) errors.push(`${relativePath}: отсутствует обязательный marker: ${marker}`);
  }
}

export async function validateKafedraAiSkillsProfile({ root = process.cwd() } = {}) {
  const projectRoot = resolve(root);
  const errors = [];
  const manifestBuffer = await readRequired(projectRoot, PROFILE_MANIFEST, errors);
  if (!manifestBuffer) return errors;

  let manifest;
  try {
    manifest = JSON.parse(manifestBuffer.toString('utf8'));
  } catch (error) {
    errors.push(`${PROFILE_MANIFEST}: невалидный JSON (${error.message})`);
    return errors;
  }

  if (manifest.schemaVersion !== 1) errors.push(`${PROFILE_MANIFEST}: schemaVersion должен быть 1`);
  if (manifest.source?.repository !== EXPECTED_REPOSITORY) errors.push(`${PROFILE_MANIFEST}: source.repository должен быть ${EXPECTED_REPOSITORY}`);
  if (manifest.source?.commit !== EXPECTED_COMMIT) errors.push(`${PROFILE_MANIFEST}: source.commit должен быть ${EXPECTED_COMMIT}`);
  if (manifest.source?.basePath !== EXPECTED_BASE_PATH) errors.push(`${PROFILE_MANIFEST}: source.basePath должен быть ${EXPECTED_BASE_PATH}`);
  if (manifest.integration?.orchestrator !== 'kafedra-workspace-orchestrator') errors.push(`${PROFILE_MANIFEST}: неверный orchestrator`);
  if (manifest.integration?.authority !== 'project-first') errors.push(`${PROFILE_MANIFEST}: authority должен быть project-first`);
  if (manifest.integration?.runtimeDependency !== false) errors.push(`${PROFILE_MANIFEST}: runtimeDependency должен быть false`);
  if (manifest.integration?.automaticUpstreamPull !== false) errors.push(`${PROFILE_MANIFEST}: automaticUpstreamPull должен быть false`);

  const entries = Array.isArray(manifest.skills) ? manifest.skills : [];
  if (entries.length !== Object.keys(EXPECTED_SKILLS).length) {
    errors.push(`${PROFILE_MANIFEST}: ожидается ровно ${Object.keys(EXPECTED_SKILLS).length} skills, получено ${entries.length}`);
  }

  const byName = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.name !== 'string') {
      errors.push(`${PROFILE_MANIFEST}: skill без корректного name`);
      continue;
    }
    if (byName.has(entry.name)) errors.push(`${PROFILE_MANIFEST}: дублируется skill ${entry.name}`);
    byName.set(entry.name, entry);
  }

  for (const [name, expectedSha] of Object.entries(EXPECTED_SKILLS)) {
    const entry = byName.get(name);
    if (!entry) {
      errors.push(`${PROFILE_MANIFEST}: отсутствует skill ${name}`);
      continue;
    }
    const localPath = expectedLocalPath(name);
    const upstreamPath = expectedUpstreamPath(name);
    if (entry.path !== localPath) errors.push(`${PROFILE_MANIFEST}: ${name}.path должен быть ${localPath}`);
    if (entry.upstreamPath !== upstreamPath) errors.push(`${PROFILE_MANIFEST}: ${name}.upstreamPath должен быть ${upstreamPath}`);
    if (entry.blobSha !== expectedSha) errors.push(`${PROFILE_MANIFEST}: ${name}.blobSha должен быть ${expectedSha}`);

    const content = await readRequired(projectRoot, localPath, errors);
    if (!content) continue;
    const actualSha = gitBlobSha(content);
    if (actualSha !== expectedSha) errors.push(`${localPath}: Git blob SHA ${actualSha}, ожидается ${expectedSha}`);
    const header = content.toString('utf8').split('\n').slice(0, 8);
    if (!header.includes(`name: ${name}`)) errors.push(`${localPath}: frontmatter name должен быть ${name}`);
  }

  for (const extraName of byName.keys()) {
    if (!(extraName in EXPECTED_SKILLS)) errors.push(`${PROFILE_MANIFEST}: неожиданный skill ${extraName}`);
  }

  for (const [relativePath, markers] of Object.entries(REQUIRED_MARKERS)) {
    checkMarkers(relativePath, await readRequired(projectRoot, relativePath, errors), markers, errors);
  }
  for (const [relativePath, markers] of Object.entries(ROLE_HANDOFF_MARKERS)) {
    checkMarkers(relativePath, await readRequired(projectRoot, relativePath, errors), markers, errors);
  }

  return errors;
}

export function formatAiSkillsProfileErrors(errors) {
  return errors.map((error) => `- ${error}`).join('\n');
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const errors = await validateKafedraAiSkillsProfile();
  if (errors.length) {
    console.error(`Kafedra AI skills profile: ${errors.length} error(s)`);
    console.error(formatAiSkillsProfileErrors(errors));
    process.exitCode = 1;
  } else {
    console.log(`Kafedra AI skills profile: OK (${Object.keys(EXPECTED_SKILLS).length} skills, ${EXPECTED_COMMIT})`);
  }
}
