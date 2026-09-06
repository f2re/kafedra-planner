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
  const design = read('docs/design.md').trim();
  if (design.length < 100) errors.push('docs/design.md must keep the substantive product design contract');
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
  if (demoRows.length === 0) {
    errors.push('catalog has no usable demo mappings');
  }
  if (!catalog.toLowerCase().includes('not a redistributed source-code library')) {
    errors.push('motion catalog must keep the upstream redistribution boundary explicit');
  }
}

if (errors.length > 0) {
  console.error('[design-governance] failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('[design-governance] ok');
