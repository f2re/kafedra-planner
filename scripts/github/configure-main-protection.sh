#!/usr/bin/env bash
set -Eeuo pipefail

REPO="${1:-${GITHUB_REPOSITORY:-f2re/kafedra-planner}}"
BRANCH="${2:-main}"

command -v gh >/dev/null || { echo 'gh CLI is required.' >&2; exit 2; }
gh auth status >/dev/null

# Keep one deterministic merge method and allow GitHub to queue the merge only after checks pass.
gh api --method PATCH "repos/${REPO}" --input - <<'JSON'
{
  "allow_squash_merge": true,
  "allow_merge_commit": false,
  "allow_rebase_merge": false,
  "allow_auto_merge": true,
  "delete_branch_on_merge": true
}
JSON

# Require a PR (zero mandatory human approvals), a fresh branch, every aggregate/project gate,
# linear history, resolved conversations, and forbid force-push/deletion even for admins.
gh api --method PUT "repos/${REPO}/branches/${BRANCH}/protection" --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "GRACE / merge-gate",
      "Минимальный Node 24.15",
      "test",
      "browser",
      "Сборщик под host Node 25.6",
      "Full offline Debian 12 + Project Control",
      "release-gate"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": false
}
JSON

echo "Applied desired protection to ${REPO}:${BRANCH}."
gh api "repos/${REPO}/branches/${BRANCH}/protection"
