import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_SOURCE = Object.freeze({
  repository: 'f2re/ai-agents-skills',
  commit: '2645ab8afd34963e80397981d582ea3b141db8e3',
  basePath: '.agents/skills',
});

const EXPECTED_SKILLS = Object.freeze([
  ['kafedra-action-recomposition', 'caa94c7bea4b7fbceb0f384edc33c2f8a3dce3df'],
  ['kafedra-adaptive-controls', '9eeb78dc1149608db649a5040d2c7708563ae6f1'],
  ['kafedra-document-intake', '2fd3199d55e5803c330586e8f47a488337cb8494'],
  ['kafedra-document-workspace', '0c853c4d9a0abd5c54fea7953a301d59a3aaa5f8'],
  ['kafedra-motion-continuity', 'cb350ffe7e5dec02ac397a9a1d3d5981a45d6d5b'],
  ['kafedra-plan-calendar-continuity', '5c5aa08c0090455902722a1e9aef1c3377a5018c'],
  ['kafedra-provenance-and-inspector', '2a2818bb5c2c1be7e14b7c1096a8b5c3d405e011'],
  ['kafedra-responsive-inspector', '8b863d0ba32ca9230567ed3ca451bd5d75ed816e'],
  ['kafedra-review-by-exception', '8d47f6eda68e57484159105af0050943361cb4b4'],
  ['kafedra-search-and-navigation', 'a0f5cb3303342308a619065698dc89264f6ff116'],
  ['kafedra-states-and-recovery', 'fc0f83ed13999614d634e6c1d0602fb5099fb9b0'],
  ['kafedra-template-and-structured-document-flow', '249828096577508af9f8aa1ca489d2a35fde3e4e'],
  ['kafedra-ux-acceptance', 'eeead5bbf0fde9eeb4d2829761bd72418324850d'],
  ['kafedra-workspace-orchestrator', 'aa5cdff00e6b518df57a45aff5e578a10b931f9c'],
]);

const REQUIRED_MARKERS = Object.freeze([
  ['AGENTS.md', ['kafedra-workspace-orchestrator', 'обязательный preflight', 'docs/KAFEDRA_SKILLS_PROFILE.md']],
  ['docs/CODEX_AGENTS.md', ['Kafedra workspace profile', 'kafedra-workspace-orchestrator']],
  ['docs/KAFEDRA_SKILLS_PROFILE.md', [EXPECTED_SOURCE.commit, 'npm run skills:check']],
  ['codex/skills/kafedra-flow-intake/SKILL.md', ['kafedra-workspace-orchestrator']],
  ['codex/skills/kafedra-design/SKILL.md', ['kafedra-workspace-orchestrator']],
  ['codex/skills/kafedra-motion/SKILL.md', ['kafedra-motion-continuity']],
  ['codex/skills/kafedra-feature/SKILL.md', ['kafedra-workspace-orchestrator']],
  ['codex/skills/kafedra-design-audit/SKILL.md', ['kafedra-ux-acceptance']],
  ['codex/skills/kafedra-tests/SKILL.md', ['kafedra-ux-acceptance', 'kafedra-states-and-recovery']],
]);

export function gitBlobSha(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const header = Buffer.from(`blob ${bytes.length}\0`);
  return createHash('sha1').update(header).update(bytes).digest('hex');
}

async function readRequired(rootDir, path, errors) {
  try {
    return await readFile(resolve(rootDir, path));
  } catch (error) {
    errors.push(`${path}: отсутствует или не читается (${error.code ?? error.message})`);
    return null;
  }
}

export async function validateKafedraSkillsProfile(rootDir = process.cwd()) {
  const errors = [];
  const manifestPath = 'codex/skills/kafedra-profile.manifest.json';
  const manifestBytes = await readRequired(rootDir, manifestPath, errors);
  if (!manifestBytes) return errors;

  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch (error) {
    return [`${manifestPath}: некорректный JSON (${error.message})`];
  }

  if (manifest.schemaVersion !== 1) errors.push(`${manifestPath}: schemaVersion должен быть 1`);
  for (const [key, expected] of Object.entries(EXPECTED_SOURCE)) {
    if (manifest.source?.[key] !== expected) {
      errors.push(`${manifestPath}: source.${key} должен быть ${expected}`);
    }
  }

  if (!Array.isArray(manifest.skills)) {
    errors.push(`${manifestPath}: skills должен быть массивом`);
    return errors;
  }
  if (manifest.skills.length !== EXPECTED_SKILLS.length) {
    errors.push(`${manifestPath}: ожидается ровно ${EXPECTED_SKILLS.length} Kafedra skills, получено ${manifest.skills.length}`);
  }

  const entries = new Map();
  for (const entry of manifest.skills) {
    if (!entry || typeof entry.name !== 'string') {
      errors.push(`${manifestPath}: каждый skill должен иметь строковое name`);
      continue;
    }
    if (entries.has(entry.name)) errors.push(`${manifestPath}: skill ${entry.name} указан повторно`);
    entries.set(entry.name, entry);
  }

  for (const [name, expectedBlob] of EXPECTED_SKILLS) {
    const entry = entries.get(name);
    const expectedSourcePath = `${EXPECTED_SOURCE.basePath}/${name}/SKILL.md`;
    const expectedLocalPath = `codex/skills/${name}/SKILL.md`;
    if (!entry) {
      errors.push(`${manifestPath}: отсутствует обязательный skill ${name}`);
      continue;
    }
    if (entry.sourcePath !== expectedSourcePath) errors.push(`${name}: sourcePath должен быть ${expectedSourcePath}`);
    if (entry.localPath !== expectedLocalPath) errors.push(`${name}: localPath должен быть ${expectedLocalPath}`);
    if (entry.blobSha !== expectedBlob) errors.push(`${name}: manifest blobSha должен быть ${expectedBlob}`);

    const bytes = await readRequired(rootDir, expectedLocalPath, errors);
    if (!bytes) continue;
    const actualBlob = gitBlobSha(bytes);
    if (actualBlob !== expectedBlob) {
      errors.push(`${expectedLocalPath}: Git blob ${actualBlob} не совпадает с pinned upstream ${expectedBlob}`);
    }
    const text = bytes.toString('utf8');
    if (!new RegExp(`^name: ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(text)) {
      errors.push(`${expectedLocalPath}: frontmatter name не совпадает с ${name}`);
    }
  }

  for (const name of entries.keys()) {
    if (!EXPECTED_SKILLS.some(([expectedName]) => expectedName === name)) {
      errors.push(`${manifestPath}: неизвестный skill ${name}; профиль не должен расширяться молча`);
    }
  }

  for (const [path, markers] of REQUIRED_MARKERS) {
    const bytes = await readRequired(rootDir, path, errors);
    if (!bytes) continue;
    const text = bytes.toString('utf8');
    for (const marker of markers) {
      if (!text.includes(marker)) errors.push(`${path}: отсутствует обязательный routing marker: ${marker}`);
    }
  }

  return errors;
}

async function main() {
  const errors = await validateKafedraSkillsProfile();
  if (errors.length) {
    console.error(`Kafedra skills profile: FAIL (${errors.length})`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Kafedra skills profile: OK (${EXPECTED_SKILLS.length} skills, upstream ${EXPECTED_SOURCE.commit})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
