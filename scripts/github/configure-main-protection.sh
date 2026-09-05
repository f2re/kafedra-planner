#!/usr/bin/env bash
set -Eeuo pipefail

REPO="${1:-${GITHUB_REPOSITORY:-f2re/kafedra-planner}}"
BRANCH="${2:-main}"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

command -v gh >/dev/null || { echo 'gh CLI is required.' >&2; exit 2; }
command -v node >/dev/null || { echo 'Node.js is required.' >&2; exit 2; }
gh auth status >/dev/null

# Keep one deterministic merge method. Conditional risk workflows are inspected
# when they run, but only the always-present ordinary check is branch-required.
gh api --method PATCH "repos/${REPO}" --input - <<'JSON'
{
  "allow_squash_merge": true,
  "allow_merge_commit": false,
  "allow_rebase_merge": false,
  "allow_auto_merge": true,
  "delete_branch_on_merge": true
}
JSON

node "$ROOT/scripts/github/required-checks.mjs" --protection-json \
  | gh api --method PUT "repos/${REPO}/branches/${BRANCH}/protection" --input -

echo "Applied desired protection to ${REPO}:${BRANCH}."
gh api "repos/${REPO}/branches/${BRANCH}/protection"
