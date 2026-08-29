#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.KAFEDRA_DESIGN_ROOT || path.join(scriptDir, '..'));

const REQUIRED_FILES = [
  'docs/design.md',
  'docs/MOTION_DESIGN.md',
  'docs/design/reactiive-motion-catalog.md',
  'codex/skills/kafedra-design/SKILL.md',
  'codex/skills/kafedra-motion/SKILL.md',
  'codex/skills/kafedra-design-audit/SKILL.md',
];

const errors = [];
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const exists = relativePath => fs.existsSync(path.join(root, relativePath));

for (const relativePath of REQUIRED_FILES) {
  if (!exists(relativePath)) errors.push(`missing required design artifact: ${relativePath}`);
}

if (exists('docs/design.md')) {
  const design = read('docs/design.md');
  for (const marker of ['Apple-inspired', 'kafedra-motion', 'kafedra-design-audit']) {
    if (!design.includes(marker)) errors.push(`docs/design.md must contain ${marker}`);
  }
}

if (exists('docs/MOTION_DESIGN.md')) {
  const motion = read('docs/MOTION_DESIGN.md');
  for (const marker of ['prefers-reduced-motion', 'no-motion', 'direct manipulation']) {
    if (!motion.toLowerCase().includes(marker.toLowerCase())) {
      errors.push(`docs/MOTION_DESIGN.md must describe ${marker}`);
    }
  }
}

if (exists('docs/design/reactiive-motion-catalog.md')) {
  const catalog = read('docs/design/reactiive-motion-catalog.md');
  const demoRows = catalog.split(/\r?\n/).filter(line => /^- `[^`]+` → `[^`]+`$/.test(line));
  if (demoRows.length !== 123) {
    errors.push(`motion catalog must index exactly 123 demos, found ${demoRows.length}`);
  }
  if (!catalog.includes('not a redistributed source-code library')) {
    errors.push('motion catalog must keep the upstream redistribution boundary explicit');
  }
}

const activeRoot = path.join(root, '.grace', 'changes', 'active');
if (fs.existsSync(activeRoot)) {
  const activeChanges = fs.readdirSync(activeRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();

  for (const changeId of activeChanges) {
    const planPath = path.join(activeRoot, changeId, 'plan.xml');
    if (!fs.existsSync(planPath)) continue;
    const plan = fs.readFileSync(planPath, 'utf8');
    const scope = plan.match(/<ObservedWriteScope>([\s\S]*?)<\/ObservedWriteScope>/)?.[1] || '';
    const touchesPublicUi = /<(?:File|Glob)>public\//.test(scope);
    if (!touchesPublicUi) continue;

    const lower = plan.toLowerCase();
    const requiredText = [
      ['desktop', /desktop/],
      ['mobile', /mobile/],
      ['prefers-reduced-motion', /prefers-reduced-motion/],
    ];
    for (const [name, pattern] of requiredText) {
      if (!pattern.test(lower)) errors.push(`${changeId}: UI plan must include ${name} acceptance`);
    }

    const stagePatterns = [
      ['kafedra-design', /<Title>[^<]*kafedra-design:/i],
      ['kafedra-motion', /<Title>[^<]*kafedra-motion:/i],
      ['kafedra-feature', /<Title>[^<]*kafedra-feature:/i],
      ['kafedra-design-audit', /<Title>[^<]*kafedra-design-audit:/i],
      ['kafedra-tests', /<Title>[^<]*kafedra-tests:/i],
    ];
    const positions = [];
    for (const [name, pattern] of stagePatterns) {
      const match = pattern.exec(plan);
      if (!match) {
        errors.push(`${changeId}: UI plan must contain a ${name} task`);
        positions.push(-1);
      } else {
        positions.push(match.index);
      }
    }
    if (positions.every(position => position >= 0)) {
      for (let index = 1; index < positions.length; index += 1) {
        if (positions[index] <= positions[index - 1]) {
          errors.push(`${changeId}: specialist order must be kafedra-design → kafedra-motion → kafedra-feature → kafedra-design-audit → kafedra-tests`);
          break;
        }
      }
    }
  }
}

if (errors.length > 0) {
  console.error('[design-governance] failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('[design-governance] ok');
