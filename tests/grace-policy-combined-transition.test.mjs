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

import { runPolicy } from '../scripts/github/grace-policy-gate.mjs';

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
  const root = mkdtempSync(join(tmpdir(), 'kafedra-grace-combined-'));
  git(root, 'init');
  git(root, 'config', 'user.name', 'GRACE test');
  git(root, 'config', 'user.email', 'grace@example.invalid');
  return root;
}

const spec = (id, status = 'approved') =>
  `<GraceChangeSpec graceVersion="4.0" status="${status}"><${id}><Summary>x</Summary></${id}></GraceChangeSpec>`;
const plan = (id, status = 'approved') =>
  `<GraceChangePlan graceVersion="4.0" status="${status}"><${id}><ObservedWriteScope><Glob>.grace/changes/active/${id}/**</Glob><File>docs/change.md</File></ObservedWriteScope></${id}></GraceChangePlan>`;

function archiveOldChange(root, id, { mutate = false } = {}) {
  mkdirSync(join(root, '.grace/changes/archive'), { recursive: true });
  renameSync(
    join(root, `.grace/changes/active/${id}`),
    join(root, `.grace/changes/archive/${id}`)
  );
  for (const name of ['spec.xml', 'plan.xml']) {
    const path = join(root, `.grace/changes/archive/${id}/${name}`);
    const source = readFileSync(path, 'utf8');
    let terminal = source.replace('status="approved"', 'status="applied"');
    if (mutate && name === 'plan.xml') terminal = terminal.replace('</ObservedWriteScope>', '<File>unexpected.txt</File></ObservedWriteScope>');
    writeFileSync(path, terminal);
  }
}

function addNewChange(root, id) {
  write(root, `.grace/changes/active/${id}/spec.xml`, spec(id));
  write(root, `.grace/changes/active/${id}/plan.xml`, plan(id));
  write(root, 'docs/change.md', 'implemented\n');
}

test('policy permits terminal archive together with the next governed change', () => {
  const root = createRepository();
  try {
    const oldId = 'C-OLD';
    const newId = 'C-NEW';
    write(root, `.grace/changes/active/${oldId}/spec.xml`, spec(oldId));
    write(root, `.grace/changes/active/${oldId}/plan.xml`, plan(oldId));
    write(root, 'docs/change.md', 'baseline\n');
    const base = commitAll(root, 'approved old change');

    archiveOldChange(root, oldId);
    addNewChange(root, newId);
    commitAll(root, 'archive old and implement new');

    const result = runPolicy({ root, base, head: 'HEAD', mode: 'pr' });
    assert.equal(result.lifecycle, 'active');
    assert.equal(result.stage, 'implementation');
    assert.equal(result.changeId, newId);
    assert.equal(result.archivedChangeId, oldId);
    assert.equal(result.archiveStatus, 'applied');
    assert.equal(result.assertionMode, 'final');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('combined transition still rejects mutation of the archived contract', () => {
  const root = createRepository();
  try {
    const oldId = 'C-OLD';
    const newId = 'C-NEW';
    write(root, `.grace/changes/active/${oldId}/spec.xml`, spec(oldId));
    write(root, `.grace/changes/active/${oldId}/plan.xml`, plan(oldId));
    write(root, 'docs/change.md', 'baseline\n');
    const base = commitAll(root, 'approved old change');

    archiveOldChange(root, oldId, { mutate: true });
    addNewChange(root, newId);
    commitAll(root, 'mutate old archive and implement new');

    assert.throws(
      () => runPolicy({ root, base, head: 'HEAD', mode: 'pr' }),
      /plan\.xml changed during archive transition/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
