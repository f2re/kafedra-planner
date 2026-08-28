#!/usr/bin/env node
import {
  analyzeMigrationDiff,
  changedPaths,
  collectChangedChangeIds,
  inspectChangeBundle,
  isSignificantPath,
  listTreeFiles,
  migrationEvidenceErrors,
  parseArguments,
  readChangedEntries,
  repositoryRoot,
  scopeMatches,
  writeGithubOutput
} from './lib/grace-governance.mjs';

export function evaluateGovernancePolicy({ root, base, head, entries, requireArchived = false }) {
  const errors = [];
  const warnings = [];
  const allPaths = changedPaths(entries);
  const significantPaths = allPaths.filter(isSignificantPath);
  const changedBundles = collectChangedChangeIds(entries);
  const bundles = [];

  for (const [changeId, locations] of changedBundles) {
    for (const location of locations) {
      const bundle = inspectChangeBundle(root, location, changeId);
      bundles.push(bundle);
      errors.push(...bundle.errors);
    }
  }

  const executableBundles = bundles.filter((bundle) => bundle.valid);
  const activeBundles = executableBundles.filter((bundle) => bundle.location === 'active');
  const archivedBundles = executableBundles.filter((bundle) => bundle.location === 'archive');
  const readyForMerge = significantPaths.length === 0
    || (activeBundles.length === 0 && archivedBundles.length > 0);

  if (significantPaths.length > 0 && executableBundles.length === 0) {
    errors.push('Существенный diff обязан содержать изменённый approved active или applied archive GRACE C-* bundle.');
  }
  if (requireArchived && significantPaths.length > 0 && !readyForMerge) {
    errors.push('Финальный merge-gate требует applied bundle в .grace/changes/archive и запрещает active C-* для этого diff.');
  }

  if (executableBundles.length > 0) {
    const scopes = executableBundles.map((bundle) => bundle.scope);
    for (const filePath of allPaths) {
      if (filePath.startsWith('.grace/changes/')) continue;
      if (!scopes.some((scope) => scopeMatches(scope, filePath))) {
        errors.push(`Файл вне ObservedWriteScope изменённого C-* bundle: ${filePath}`);
      }
    }
  }

  const baseMigrationFiles = listTreeFiles(base, 'migrations', { cwd: root });
  const headMigrationFiles = listTreeFiles(head, 'migrations', { cwd: root });
  const migration = analyzeMigrationDiff({ entries, baseFiles: baseMigrationFiles, headFiles: headMigrationFiles });
  errors.push(...migration.errors);

  if (migration.newMigrations.length > 0) {
    const migrationTestChanged = allPaths.some((filePath) => (
      /^tests\/.*(?:migration|schema|database).*\.test\.mjs$/i.test(filePath)
    ));
    if (!migrationTestChanged) {
      errors.push('Новая SQL-миграция требует изменённый regression-test с migration/schema/database в имени.');
    }
    errors.push(...migrationEvidenceErrors(executableBundles.map((bundle) => bundle.planXml || '')));
  }

  if (significantPaths.length === 0 && executableBundles.length > 0) {
    warnings.push('C-* bundle изменён без существенного product/engineering diff; проверьте, нужен ли отдельный change lifecycle.');
  }

  return {
    ok: errors.length === 0,
    base,
    head,
    errors,
    warnings,
    changedPaths: allPaths,
    significantPaths,
    bundles: bundles.map((bundle) => ({
      changeId: bundle.changeId,
      location: bundle.location,
      specStatus: bundle.specStatus,
      planStatus: bundle.planStatus,
      valid: bundle.valid
    })),
    migrations: {
      baseMax: migration.baseMax,
      headMax: migration.headMax,
      added: migration.newMigrations.map((item) => item.path)
    },
    readyForMerge
  };
}

function render(result) {
  console.log(`GRACE policy: ${result.ok ? 'OK' : 'FAIL'}`);
  console.log(`Base: ${result.base}`);
  console.log(`Head: ${result.head}`);
  console.log(`Changed: ${result.changedPaths.length}; significant: ${result.significantPaths.length}; ready: ${result.readyForMerge}`);
  if (result.bundles.length) {
    console.log('Bundles:');
    for (const bundle of result.bundles) {
      console.log(`- ${bundle.location}/${bundle.changeId}: spec=${bundle.specStatus}, plan=${bundle.planStatus}, valid=${bundle.valid}`);
    }
  }
  if (result.migrations.added.length) console.log(`Migrations added: ${result.migrations.added.join(', ')}`);
  for (const warning of result.warnings) console.warn(`WARNING: ${warning}`);
  for (const error of result.errors) console.error(`ERROR: ${error}`);
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const root = repositoryRoot();
  const baseRef = String(args.base || process.env.GRACE_BASE_SHA || 'HEAD^');
  const headRef = String(args.head || process.env.GRACE_HEAD_SHA || 'HEAD');
  const { base, head, entries } = readChangedEntries(baseRef, headRef, { cwd: root });
  const result = evaluateGovernancePolicy({
    root,
    base,
    head,
    entries,
    requireArchived: Boolean(args['require-archived'])
  });
  render(result);
  if (args.json) console.log(JSON.stringify(result, null, 2));
  if (args['github-output']) {
    await writeGithubOutput({
      ready: result.readyForMerge,
      policy_ok: result.ok,
      base_sha: result.base,
      head_sha: result.head
    });
  }
  if (!result.ok) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
