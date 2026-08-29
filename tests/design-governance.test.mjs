import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const scriptPath = path.resolve('scripts/design-governance.mjs');

const requiredFiles = {
  'docs/design.md': 'Apple-inspired\nkafedra-motion\nkafedra-design-audit\n',
  'docs/MOTION_DESIGN.md': 'prefers-reduced-motion\nno-motion\ndirect manipulation\n',
  'codex/skills/kafedra-design/SKILL.md': 'design',
  'codex/skills/kafedra-motion/SKILL.md': 'motion',
  'codex/skills/kafedra-design-audit/SKILL.md': 'audit',
};

const catalog = [
  '# catalog',
  'This is not a redistributed source-code library.',
  ...Array.from({ length: 123 }, (_, index) => `- \`demo-${index + 1}\` → \`family\``),
].join('\n');

function makeRoot(plan) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kafedra-design-'));
  for (const [relativePath, content] of Object.entries(requiredFiles)) {
    const destination = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  }
  const catalogPath = path.join(root, 'docs/design/reactiive-motion-catalog.md');
  fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
  fs.writeFileSync(catalogPath, catalog);
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

function validPlan() {
  return `<GraceChangePlan graceVersion="4.0" status="approved">
  <C-UI>
    <ObservedWriteScope><Glob>public/**</Glob></ObservedWriteScope>
    <ImplementationPlan>
      <T-001><Title>kafedra-design: define desktop and mobile interaction</Title><AcceptanceCriteria><Criterion>Desktop and mobile states are explicit and static state is clear.</Criterion></AcceptanceCriteria></T-001>
      <T-002><Title>kafedra-motion: define restrained transition</Title><AcceptanceCriteria><Criterion>prefers-reduced-motion fallback is explicit.</Criterion></AcceptanceCriteria></T-002>
      <T-003><Title>kafedra-feature: implement UI</Title></T-003>
      <T-004><Title>kafedra-design-audit: independently review implementation</Title></T-004>
      <T-005><Title>kafedra-tests: verify browser behavior</Title></T-005>
    </ImplementationPlan>
  </C-UI>
</GraceChangePlan>`;
}

test('passes when repository artifacts exist and no active UI change is present', () => {
  const root = makeRoot(null);
  assert.match(run(root), /\[design-governance\] ok/);
});

test('passes a complete UI-scoped GRACE specialist handoff', () => {
  const root = makeRoot(validPlan());
  assert.match(run(root), /\[design-governance\] ok/);
});

test('fails closed when a UI plan omits motion/audit and reduced-motion acceptance', () => {
  const broken = `<GraceChangePlan graceVersion="4.0" status="approved"><C-UI>
    <ObservedWriteScope><File>public/app.js</File></ObservedWriteScope>
    <ImplementationPlan>
      <T-001><Title>kafedra-design: desktop and mobile design</Title></T-001>
      <T-002><Title>kafedra-feature: implement</Title></T-002>
      <T-003><Title>kafedra-tests: test</Title></T-003>
    </ImplementationPlan>
  </C-UI></GraceChangePlan>`;
  const root = makeRoot(broken);
  assert.throws(
    () => run(root),
    error => /kafedra-motion task/.test(error.stderr) && /kafedra-design-audit task/.test(error.stderr) && /prefers-reduced-motion/.test(error.stderr),
  );
});

test('rejects the wrong specialist order', () => {
  const broken = validPlan()
    .replace('<T-002><Title>kafedra-motion: define restrained transition</Title><AcceptanceCriteria><Criterion>prefers-reduced-motion fallback is explicit.</Criterion></AcceptanceCriteria></T-002>\n      <T-003><Title>kafedra-feature: implement UI</Title></T-003>', '<T-002><Title>kafedra-feature: implement UI</Title></T-002>\n      <T-003><Title>kafedra-motion: define restrained transition</Title><AcceptanceCriteria><Criterion>prefers-reduced-motion fallback is explicit.</Criterion></AcceptanceCriteria></T-003>');
  const root = makeRoot(broken);
  assert.throws(() => run(root), error => /specialist order/.test(error.stderr));
});
