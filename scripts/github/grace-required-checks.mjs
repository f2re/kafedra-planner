#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const GRACE_MERGE_CHECK = 'GRACE / merge-gate';

export const REQUIRED_MAIN_CHECKS = Object.freeze([
  GRACE_MERGE_CHECK,
  'Минимальный Node 24.15',
  'test',
  'browser',
  'Сборщик под host Node 25.6',
  'Full offline Debian 12 + Project Control',
  'release-gate',
  'organization-browser',
  'science-lifecycle-browser',
  'science-import-browser',
  'science-reports-browser'
]);

export function mainProtectionPayload() {
  return {
    required_status_checks: {
      strict: true,
      contexts: [...REQUIRED_MAIN_CHECKS]
    },
    enforce_admins: true,
    required_pull_request_reviews: {
      dismiss_stale_reviews: false,
      require_code_owner_reviews: false,
      required_approving_review_count: 0,
      require_last_push_approval: false
    },
    restrictions: null,
    required_linear_history: true,
    allow_force_pushes: false,
    allow_deletions: false,
    block_creations: false,
    required_conversation_resolution: true,
    lock_branch: false,
    allow_fork_syncing: false
  };
}

function main() {
  const mode = process.argv[2] || '--checks-json';
  if (mode === '--checks-json') {
    console.log(JSON.stringify(REQUIRED_MAIN_CHECKS));
    return;
  }
  if (mode === '--protection-json') {
    console.log(JSON.stringify(mainProtectionPayload()));
    return;
  }
  throw new Error(`Unknown mode: ${mode}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try {
    main();
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  }
}
