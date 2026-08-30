import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  changedActiveChangeIds,
  changedArchivedChangeIds,
  evaluateActiveBundle,
  evaluateArchiveTransition,
  evaluateGovernance,
  evaluateMigrationPolicy,
  extractObservedWriteScope,
  globToRegExp,
  isGovernedPath,
  parseNameStatus,
  validateObservedWriteScope
} from '../scripts/grace-governance.mjs';
import { runPolicy } from '../scripts/github/grace-policy-gate.mjs';

const approvedSpec = (id = 'C-TEST') =>
  `<GraceChangeSpec graceVersion="4.0" status="approved"><${id}><Summary>x</Summary></${id}></GraceChangeSpec>`;
const approvedPlan = (id = 'C-TEST', scope = '<Glob>.grace/**</Glob>') =>
  `<GraceChangePlan graceVersion="4.0" status="approved"><${id}><ObservedWriteScope>${scope}</ObservedWriteScope></${id}></GraceChangePlan>`;

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function write(root, path, content) {
  const target = join(root, path);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content);
}

function commitAll(root, message) {
  git(root, 'add', '-A');
  git(root, 'commit', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

function createRepository() {
  const root = mkdtempSync(join(tmpdir(), 'kafedra-grace-policy-'));
  git(root, 'init');
  git(root, 'config', 'user.name', 'GRACE test');
  git(root, 'config', 'user.email', 'grace@example.invalid');
  return root;
}

function writeCompanionBundle(root, location, id, status = 'approved') {
  const prefix = `.grace/changes/${location}/${id}`;
  write(root, `${prefix}/spec.xml`, approvedSpec(id).replace('status="approved"', `status="${status}"`));
  write(root, `${prefix}/plan.xml`, approvedPlan(id).replace('status="approved"', `status="${status}"`));
  write(root, `${prefix}/design.md`, '# Design\n\nStable hierarchy.\n');
  write(root, `${prefix}/motion.md`, '# Motion\n\nReduced motion.\n');
  write(root, `${prefix}/design-audit.md`, 'PASS\n');
}

test('ObservedWriteScope supports exact files and GRACE-style ** globs', () => {
  const xml = `
    <ObservedWriteScope>
      <File>AGENTS.md</File>
      <Glob>scripts/**/*.mjs</Glob>
      <Glob>.grace/**</Glob>
    </ObservedWriteScope>`;
  const scope = extractObservedWriteScope(xml);
  assert.deepEqual(scope.files, ['AGENTS.md']);
  assert.match('scripts/ci/check.mjs', globToRegExp('scripts/**/*.mjs'));
  assert.match('.grace/context/requirements.xml', globToRegExp('.grace/**'));
  assert.deepEqual(validateObservedWriteScope([
    'AGENTS.md',
    'scripts/grace-governance.mjs',
    'scripts/ci/check.mjs',
    '.grace/graph/main.xml'
  ], scope), []);
  assert.deepEqual(
    validateObservedWriteScope(['apps/api/src/main.mjs'], scope),
    ['apps/api/src/main.mjs']
  );
});

test('all repository surfaces are governed except direct C-* lifecycle XML', () => {
  for (const path of [
    'apps/api/src/main.mjs',
    'packages/storage/src/database.mjs',
    'tests/example.test.mjs',
    'docs/ARCHITECTURE.md',
    'codex/skills/kafedra-data/SKILL.md',
    '.github/workflows/ci.yml',
    '.github/ISSUE_TEMPLATE/feature.md',
    'playwright.config.mjs',
    '.gitignore',
    '.grace/context/requirements.xml',
    '.grace/graph/main.xml',
    '.grace/verification/main.xml',
    'README.md',
    'VERSION'
  ]) {
    assert.equal(isGovernedPath(path), true, `${path} must be governed`);
  }
  assert.equal(
    isGovernedPath('.grace/changes/active/C-WORK/spec.xml'),
    false
  );
  assert.equal(
    isGovernedPath('.grace/changes/archive/C-OLD/plan.xml'),
    false
  );
  assert.equal(
    isGovernedPath('.grace/changes/archive/C-OLD/evidence.json'),
    true
  );
});

test('active and archived change IDs are classified independently', () => {
  const entries = parseNameStatus([
    'D\t.grace/changes/active/C-DONE/spec.xml',
    'D\t.grace/changes/active/C-DONE/plan.xml',
    'A\t.grace/changes/archive/C-DONE/spec.xml',
    'A\t.grace/changes/archive/C-DONE/plan.xml'
  ].join('\n'));
  assert.deepEqual(changedActiveChangeIds(entries), ['C-DONE']);
  assert.deepEqual(changedArchivedChangeIds(entries), ['C-DONE']);
  assert.deepEqual(changedActiveChangeIds(entries, () => false), []);
});

test('branch stage permits a draft spec before implementation writes', () => {
  const draft = evaluateActiveBundle({
    changeId: 'C-DRAFT',
    specXml: '<GraceChangeSpec graceVersion="4.0" status="draft"><C-DRAFT /></GraceChangeSpec>',
    planXml: null
  });
  assert.deepEqual(draft.errors, []);
  assert.equal(draft.specStatus, 'draft');
  assert.equal(draft.planStatus, null);

  const implementation = evaluateActiveBundle({
    changeId: 'C-DRAFT',
    specXml: '<GraceChangeSpec graceVersion="4.0" status="draft"><C-DRAFT /></GraceChangeSpec>',
    planXml: null,
    requireApproved: true,
    requirePlan: true
  });
  assert.ok(implementation.errors.some((message) => /plan\.xml/.test(message)));
  assert.ok(implementation.errors.some((message) => /approved/.test(message)));
});

test('governed diff fails closed when a write escapes the approved plan', () => {
  const entries = parseNameStatus([
    'M\tAGENTS.md',
    'A\t.grace/changes/active/C-TEST/spec.xml',
    'A\t.grace/changes/active/C-TEST/plan.xml',
    'M\tapps/api/src/main.mjs'
  ].join('\n'));
  const result = evaluateGovernance({
    entries,
    changeId: 'C-TEST',
    specXml: approvedSpec(),
    planXml: approvedPlan('C-TEST', '<File>AGENTS.md</File><Glob>.grace/**</Glob>')
  });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /apps\/api\/src\/main\.mjs/);
});

test('policy continues the sole approved active change inherited from the exact base', () => {
  const root = createRepository();
  try {
    write(root, '.grace/changes/archive/.gitkeep', '');
    write(root, '.grace/changes/active/C-CONTINUE/spec.xml', approvedSpec('C-CONTINUE'));
    write(
      root,
      '.grace/changes/active/C-CONTINUE/plan.xml',
      approvedPlan('C-CONTINUE', '<File>docs/GRACE_GOVERNANCE.md</File><Glob>.grace/**</Glob>')
    );
    write(root, 'docs/GRACE_GOVERNANCE.md', 'baseline\n');
    const base = commitAll(root, 'approved active base');

    write(root, 'docs/GRACE_GOVERNANCE.md', 'hardened\n');
    commitAll(root, 'continue active implementation');

    const result = runPolicy({ root, base, head: 'HEAD', mode: 'pr' });
    assert.equal(result.lifecycle, 'active');
    assert.equal(result.stage, 'implementation');
    assert.equal(result.assertionMode, 'final');
    assert.equal(result.changeId, 'C-CONTINUE');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('archive-only transition preserves Markdown companion artifacts and changes only terminal status', () => {
  const entries = parseNameStatus([
    'D\t.grace/changes/active/C-DONE/spec.xml',
    'D\t.grace/changes/active/C-DONE/plan.xml',
    'D\t.grace/changes/active/C-DONE/design.md',
    'D\t.grace/changes/active/C-DONE/motion.md',
    'D\t.grace/changes/active/C-DONE/design-audit.md',
    'A\t.grace/changes/archive/C-DONE/spec.xml',
    'A\t.grace/changes/archive/C-DONE/plan.xml',
    'A\t.grace/changes/archive/C-DONE/design.md',
    'A\t.grace/changes/archive/C-DONE/motion.md',
    'A\t.grace/changes/archive/C-DONE/design-audit.md'
  ].join('\n'));
  const baseArtifacts = {
    'spec.xml': approvedSpec('C-DONE'),
    'plan.xml': approvedPlan('C-DONE'),
    'design.md': '# Design\n',
    'motion.md': '# Motion\n',
    'design-audit.md': 'PASS\n'
  };
  const archivedArtifacts = Object.fromEntries(
    Object.entries(baseArtifacts).map(([name, value]) => [
      name,
      /\.xml$/u.test(name) ? value.replace('status="approved"', 'status="applied"') : value
    ])
  );
  const valid = evaluateArchiveTransition({
    entries,
    changeId: 'C-DONE',
    baseArtifacts,
    archivedArtifacts,
    activeArtifactsAtHead: {}
  });
  assert.deepEqual(valid.errors, []);
  assert.equal(valid.status, 'applied');

  archivedArtifacts['design.md'] = '# Mutated design\n';
  const mutated = evaluateArchiveTransition({
    entries,
    changeId: 'C-DONE',
    baseArtifacts,
    archivedArtifacts,
    activeArtifactsAtHead: {}
  });
  assert.ok(mutated.errors.some((message) => /changed during archive transition/.test(message)));
});

test('policy accepts staged branch work, rejects active-only PR, and governs durable GRACE context', () => {
  const root = createRepository();
  try {
    write(root, '.grace/changes/archive/.gitkeep', '');
    write(root, '.grace/context/requirements.xml', '<GraceRequirements graceVersion="4.0" />');
    commitAll(root, 'base');
    const base = git(root, 'rev-parse', 'HEAD');

    write(
      root,
      '.grace/changes/active/C-STAGED/spec.xml',
      '<GraceChangeSpec graceVersion="4.0" status="draft"><C-STAGED /></GraceChangeSpec>'
    );
    commitAll(root, 'draft spec');

    const branchResult = runPolicy({ root, base, head: 'HEAD', mode: 'branch' });
    assert.equal(branchResult.stage, 'draft');
    assert.equal(branchResult.assertionMode, 'current');
    assert.throws(
      () => runPolicy({ root, base, head: 'HEAD', mode: 'pr' }),
      /only an active C-\* bundle/
    );

    rmSync(join(root, '.grace/changes/active'), { recursive: true, force: true });
    write(root, '.grace/context/requirements.xml', '<GraceRequirements graceVersion="4.0"><Changed /></GraceRequirements>');
    commitAll(root, 'uncontracted context drift');
    assert.throws(
      () => runPolicy({ root, base, head: 'HEAD', mode: 'branch' }),
      /exactly one complete active C-\* bundle/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('policy validates a real approved-active to applied-archive transition with Markdown companion artifacts', () => {
  const root = createRepository();
  try {
    writeCompanionBundle(root, 'active', 'C-DONE');
    const base = commitAll(root, 'approved active change');

    mkdirSync(join(root, '.grace/changes/archive'), { recursive: true });
    renameSync(
      join(root, '.grace/changes/active/C-DONE'),
      join(root, '.grace/changes/archive/C-DONE')
    );
    for (const name of ['spec.xml', 'plan.xml']) {
      const path = join(root, `.grace/changes/archive/C-DONE/${name}`);
      const source = readFileSync(path, 'utf8');
      writeFileSync(path, source.replace('status="approved"', 'status="applied"'));
    }
    commitAll(root, 'archive applied change');

    const result = runPolicy({ root, base, head: 'HEAD', mode: 'pr' });
    assert.equal(result.lifecycle, 'archive');
    assert.equal(result.archivedChangeId, 'C-DONE');
    assert.equal(result.archiveStatus, 'applied');
    assert.equal(result.assertionMode, 'current');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('policy rejects a terminal archive with an outside write', () => {
  const root = createRepository();
  try {
    writeCompanionBundle(root, 'active', 'C-DONE');
    write(root, 'docs/GRACE_GOVERNANCE.md', 'baseline\n');
    const base = commitAll(root, 'approved active change');

    mkdirSync(join(root, '.grace/changes/archive'), { recursive: true });
    renameSync(
      join(root, '.grace/changes/active/C-DONE'),
      join(root, '.grace/changes/archive/C-DONE')
    );
    for (const name of ['spec.xml', 'plan.xml']) {
      const path = join(root, `.grace/changes/archive/C-DONE/${name}`);
      const source = readFileSync(path, 'utf8');
      writeFileSync(path, source.replace('status="approved"', 'status="applied"'));
    }
    write(root, 'docs/GRACE_GOVERNANCE.md', 'outside write\n');
    commitAll(root, 'archive plus product documentation');

    assert.throws(
      () => runPolicy({ root, base, head: 'HEAD', mode: 'pr' }),
      /Archive-only transition contains non-lifecycle writes: docs\/GRACE_GOVERNANCE\.md/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('policy rejects mutation of a Markdown companion during terminal archive', () => {
  const root = createRepository();
  try {
    writeCompanionBundle(root, 'active', 'C-DONE');
    const base = commitAll(root, 'approved active change');

    mkdirSync(join(root, '.grace/changes/archive'), { recursive: true });
    renameSync(
      join(root, '.grace/changes/active/C-DONE'),
      join(root, '.grace/changes/archive/C-DONE')
    );
    for (const name of ['spec.xml', 'plan.xml']) {
      const path = join(root, `.grace/changes/archive/C-DONE/${name}`);
      const source = readFileSync(path, 'utf8');
      writeFileSync(path, source.replace('status="approved"', 'status="applied"'));
    }
    write(root, '.grace/changes/archive/C-DONE/design.md', '# Changed during archive\n');
    commitAll(root, 'mutate archived companion');

    assert.throws(
      () => runPolicy({ root, base, head: 'HEAD', mode: 'pr' }),
      /design\.md changed during archive transition/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('policy rejects a direct rewrite of an existing archive', () => {
  const root = createRepository();
  try {
    writeCompanionBundle(root, 'archive', 'C-DONE', 'applied');
    const base = commitAll(root, 'existing archive');

    write(root, '.grace/changes/archive/C-DONE/design.md', '# Rewritten archive\n');
    commitAll(root, 'rewrite existing archive');

    assert.throws(
      () => runPolicy({ root, base, head: 'HEAD', mode: 'pr' }),
      /Archived C-\* bundles may change only in one immutable archive-only transition/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('applied migrations are immutable', () => {
  const result = evaluateMigrationPolicy({
    baseMigrationFiles: ['migrations/001_initial.sql', 'migrations/002_next.sql'],
    entries: parseNameStatus('M\tmigrations/002_next.sql'),
    changedTestFiles: []
  });
  assert.ok(result.errors.some((message) => /immutable/.test(message)));
});

test('new migrations must be contiguous, tested and declared as database work', () => {
  const valid = evaluateMigrationPolicy({
    baseMigrationFiles: ['migrations/001_initial.sql', 'migrations/002_next.sql'],
    entries: parseNameStatus('A\tmigrations/003_feature.sql\nM\ttests/feature-migration.test.mjs'),
    changedTestFiles: ['tests/feature-migration.test.mjs'],
    specXml: '<AffectedAreas><M-DATABASE /></AffectedAreas>',
    planXml: '<VerificationAnchors><V-M-DATABASE /></VerificationAnchors>'
  });
  assert.deepEqual(valid.errors, []);

  const invalid = evaluateMigrationPolicy({
    baseMigrationFiles: ['migrations/001_initial.sql', 'migrations/002_next.sql'],
    entries: parseNameStatus('A\tmigrations/004_gap.sql'),
    changedTestFiles: [],
    specXml: '',
    planXml: ''
  });
  assert.ok(invalid.errors.some((message) => /expected 003/.test(message)));
  assert.ok(invalid.errors.some((message) => /migration.*test/i.test(message)));
  assert.ok(invalid.errors.some((message) => /M-DATABASE/.test(message)));
  assert.ok(invalid.errors.some((message) => /V-M-DATABASE/.test(message)));
});
