#!/usr/bin/env bash
set -Eeuo pipefail

PR="${1:?Usage: merge-grace-pr.sh <pr-number> [owner/repo]}"
REPO="${2:-${GITHUB_REPOSITORY:-f2re/kafedra-planner}}"
command -v gh >/dev/null || { echo 'gh CLI is required.' >&2; exit 2; }

JSON="$(gh pr view "$PR" --repo "$REPO" --json isDraft,headRefOid,mergeStateStatus,statusCheckRollup,url)"
HEAD_SHA="$(node -e 'const v=JSON.parse(process.argv[1]); if(v.isDraft) throw new Error("PR is draft"); if(v.mergeStateStatus!=="CLEAN") throw new Error(`mergeStateStatus=${v.mergeStateStatus}`); const bad=(v.statusCheckRollup||[]).filter(x=>x.status!=="COMPLETED" || x.conclusion!=="SUCCESS"); if(bad.length) throw new Error(`checks not complete/success: ${bad.map(x=>x.name||x.context).join(", ")}`); process.stdout.write(v.headRefOid);' "$JSON")"

# --match-head-commit prevents a stale approval/check result from merging a newer head.
gh pr merge "$PR" --repo "$REPO" --squash --delete-branch --match-head-commit "$HEAD_SHA"
printf 'Merged PR #%s at verified head %s\n' "$PR" "$HEAD_SHA"
