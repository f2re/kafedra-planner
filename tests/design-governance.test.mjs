import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const scriptPath = path.resolve('scripts/design-governance.mjs');

const requiredFiles = {
  'docs/design.md': '# Product design contract\nCalm document workspace with clear hierarchy, predictable responsive behavior, keyboard access and obvious primary actions. The interface remains understandable without decorative effects.\n',
  'docs/MOTION_DESIGN.md': 'prefers-reduced-motion\nno-motion\ndirect manipulation\n',
  'codex/skills/kafedra-design/SKILL.md': 'design',
  'codex/skills/kafedra-motion/SKILL.md': 'motion',
  'codex/skills/kafedra-design-audit/SKILL.md': 'audit',
};

const catalog = [
  '# catalog',
  'This is not a redistributed source-code library.',
  '- `demo-one` → `continuity`',
  '- `demo-two` → `direct-manipulation`',
].join('\n');

function makeRoot({ plan = null, files = {}, catalogContent = catalog } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kafedra-design-'));
  for (const [relativePath, content] of Object.entries({ ...requiredFiles, ...files })) {
    if (content === null) continue;
    const destination = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  }
  if (catalogContent !== null) {
    const catalogPath = path.join(root, 'docs/design/reactiive-motion-catalog.md');
    fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
    fs.writeFileSync(catalogPath, catalogContent);
  }
  if (plan !== null) {
    const planPath = path.join(root, '.grace/changes/active/C-UI/plan.xml');
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, plan);
  }
  return root;
}

function run(root) {
  return execFileSync(process.execPath, [scriptPath], {
    cwd: path.resolve('.'),
    env: { ...process.env, KAFEDRA_DESIGN_ROOT: root },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function compactUiPlan() {
  return `<GraceChangePlan graceVersion="4.0" status="approved"><C-UI>
    <ObservedWriteScope><File>public/app.js</File></ObservedWriteScope>
    <ImplementationPlan>
      <T-001><Title>kafedra-feature: simplify one existing control</Title></T-001>
      <T-002><Title>kafedra-tests: verify the affected layout</Title></T-002>
    </ImplementationPlan>
  </C-UI></GraceChangePlan>`;
}

test('passes when substantive design artifacts exist without style slogans or fixed catalog size', () => {
  const root = makeRoot();
  assert.match(run(root), /\[design-governance\] ok/);
});

test('a local UI change does not require a fixed five-role GRACE choreography', () => {
  const root = makeRoot({ plan: compactUiPlan() });
  assert.match(run(root), /\[design-governance\] ok/);
});

test('fails closed when a required design source disappears', () => {
  const root = makeRoot({ files: { 'codex/skills/kafedra-design-audit/SKILL.md': null } });
  assert.throws(() => run(root), error => /missing required design artifact/.test(error.stderr));
});

test('fails closed when the motion safety contract loses reduced-motion or no-motion guidance', () => {
  const root = makeRoot({ files: { 'docs/MOTION_DESIGN.md': 'direct manipulation only\n' } });
  assert.throws(
    () => run(root),
    error => /prefers-reduced-motion/.test(error.stderr) && /no-motion/.test(error.stderr),
  );
});

test('catalog size may change but usable mappings and redistribution boundary remain required', () => {
  const noMappings = makeRoot({ catalogContent: '# catalog\nThis is not a redistributed source-code library.\n' });
  assert.throws(() => run(noMappings), error => /catalog has no usable demo mappings/.test(error.stderr));

  const noBoundary = makeRoot({ catalogContent: '# catalog\n- `demo` → `family`\n' });
  assert.throws(() => run(noBoundary), error => /redistribution boundary/.test(error.stderr));
});
