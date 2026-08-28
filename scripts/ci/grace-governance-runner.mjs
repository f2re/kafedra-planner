import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  changedActiveChangeIds,
  changedPaths,
  isGovernedPath,
  parseNameStatus,
  touchedChangeIds
} from './grace-scope-core.mjs';
import {
  evaluateArchiveTransition,
  evaluateGovernance
} from './grace-change-core.mjs';
import { evaluateMigrationPolicy } from './grace-migration-policy.mjs';
import { checkDatabaseIntegrity } from './grace-db-integrity.mjs';

function git(args, { root = process.cwd(), trim = true } = {}) {
  const output = execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return trim ? output.trim() : output;
}

function resolveChangeBundle(root, state, changeId) {
  const dir = resolve(root, '.grace', 'changes', state, changeId);
  return {
    dir,
    spec: resolve(dir, 'spec.xml'),
    plan: resolve(dir, 'plan.xml')
  };
}

function completeBundleExists(root, state, changeId) {
  const bundle = resolveChangeBundle(root, state, changeId);
  return existsSync(bundle.spec) && existsSync(bundle.plan);
}

function readBundle(root, state, changeId) {
  const bundle = resolveChangeBundle(root, state, changeId);
  if (!existsSync(bundle.spec) || !existsSync(bundle.plan)) {
    throw new Error(`Incomplete GRACE bundle: .grace/changes/${state}/${changeId}.`);
  }
  return {
    specXml: readFileSync(bundle.spec, 'utf8'),
    planXml: readFileSync(bundle.plan, 'utf8')
  };
}

export function runPolicy({ root = process.cwd(), base = 'origin/main', head = 'HEAD' } = {}) {
  const entries = parseNameStatus(
    git(['diff', '--name-status', '-M', `${base}...${head}`], { root, trim: false })
  );
  const paths = changedPaths(entries);
  const touchedActiveIds = touchedChangeIds(entries, 'active');
  const archiveIds = touchedChangeIds(entries, 'archive');

  if (archiveIds.length > 0) {
    if (
      archiveIds.length !== 1
      || touchedActiveIds.length !== 1
      || archiveIds[0] !== touchedActiveIds[0]
    ) {
      throw new Error(
        `Archive writes require one matching active → archive C-* transition; `
        + `active=${touchedActiveIds.join(', ') || 'none'}, archive=${archiveIds.join(', ') || 'none'}.`
      );
    }
    const changeId = archiveIds[0];
    if (completeBundleExists(root, 'active', changeId)) {
      throw new Error(`Archive transition left ${changeId} active at HEAD.`);
    }
    if (!completeBundleExists(root, 'archive', changeId)) {
      throw new Error(`Archive transition did not create a complete ${changeId} archive bundle.`);
    }
    const bundle = readBundle(root, 'archive', changeId);
    const result = evaluateArchiveTransition({ entries, changeId, ...bundle });
    if (result.errors.length) throw new Error(result.errors.join('\n'));
    return {
      ok: true,
      mode: 'archive',
      changeId: null,
      archivedChangeId: changeId,
      paths
    };
  }

  const activeIds = changedActiveChangeIds(
    entries,
    (changeId) => completeBundleExists(root, 'active', changeId)
  );
  const governed = paths.filter(isGovernedPath);
  if (governed.length > 0 && activeIds.length !== 1) {
    throw new Error(
      `Governed diff must introduce or update exactly one active C-* bundle; `
      + `found ${activeIds.length}: ${activeIds.join(', ') || 'none'}.`
    );
  }
  if (activeIds.length > 1) {
    throw new Error(`Only one active C-* bundle is allowed per branch diff: ${activeIds.join(', ')}.`);
  }
  const changeId = activeIds[0] || null;
  if (!changeId) {
    return { ok: true, mode: 'trivial', changeId: null, paths, governed };
  }

  const bundle = readBundle(root, 'active', changeId);
  const result = evaluateGovernance({ entries, changeId, ...bundle });
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  return {
    ok: true,
    mode: 'active',
    changeId,
    paths: result.paths,
    governed: result.governed
  };
}

function migrationFilesAtRef(root, ref) {
  const output = git(['ls-tree', '-r', '--name-only', ref, '--', 'migrations'], {
    root,
    trim: false
  });
  return output.split('\n').map((line) => line.trim()).filter(Boolean);
}

export function runMigrationPolicy({ root = process.cwd(), base = 'origin/main', head = 'HEAD' } = {}) {
  const entries = parseNameStatus(
    git(['diff', '--name-status', '-M', `${base}...${head}`], { root, trim: false })
  );
  const activeIds = changedActiveChangeIds(
    entries,
    (changeId) => completeBundleExists(root, 'active', changeId)
  );
  const changeId = activeIds.length === 1 ? activeIds[0] : null;
  let specXml = '';
  let planXml = '';
  if (changeId) ({ specXml, planXml } = readBundle(root, 'active', changeId));

  const result = evaluateMigrationPolicy({
    baseMigrationFiles: migrationFilesAtRef(root, base),
    entries,
    changedTestFiles: changedPaths(entries).filter((path) => path.startsWith('tests/')),
    specXml,
    planXml
  });
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  return { ok: true, added: result.added, changeId };
}

function parseArgs(argv) {
  const values = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      values._.push(value);
      continue;
    }
    const key = value.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      values[key] = next;
      index += 1;
    } else {
      values[key] = true;
    }
  }
  return values;
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0] || 'policy';
  const root = resolve(args.root || process.cwd());
  const base = args.base || process.env.GRACE_BASE_REF || 'origin/main';
  const head = args.head || process.env.GRACE_HEAD_REF || 'HEAD';

  if (command === 'policy') {
    const result = runPolicy({ root, base, head });
    if (args.githubOutput && process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `change_id=${result.changeId || ''}\n`);
      appendFileSync(process.env.GITHUB_OUTPUT, `mode=${result.mode || ''}\n`);
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `archived_change_id=${result.archivedChangeId || ''}\n`
      );
    }
    console.log(JSON.stringify(result));
    return result;
  }
  if (command === 'migrations') {
    const result = runMigrationPolicy({ root, base, head });
    console.log(JSON.stringify(result));
    return result;
  }
  if (command === 'db-integrity') {
    if (!args.database) throw new Error('db-integrity requires --database <path>.');
    const result = checkDatabaseIntegrity({
      databasePath: args.database,
      migrationsDir: args.migrationsDir || resolve(root, 'migrations')
    });
    console.log(JSON.stringify(result));
    return result;
  }
  throw new Error(`Unknown command: ${command}`);
}
