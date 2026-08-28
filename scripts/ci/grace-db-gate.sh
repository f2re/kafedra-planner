#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(git rev-parse --show-toplevel)"
BASE_REF="${1:-${GRACE_BASE_REF:-origin/main}}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cd "$ROOT"
git cat-file -e "${BASE_REF}^{commit}"

BASE_APP="$TMP/base-app"
mkdir -p "$BASE_APP"
git archive "$BASE_REF" | tar -x -C "$BASE_APP"

run_migrate() {
  local app="$1" data="$2" skip_backup="$3"
  mkdir -p "$data"
  KAFEDRA_APPLICATION_DIR="$app" \
  KAFEDRA_DATA_DIR="$data" \
  KAFEDRA_DATABASE_PATH="$data/kafedra-planner.sqlite3" \
  KAFEDRA_BACKUP_DIR="$data/backups" \
  KAFEDRA_BACKUP_INCLUDE_APPLICATION=false \
  KAFEDRA_SKIP_AUTO_BACKUP="$skip_backup" \
    node "$app/scripts/migrate.mjs"
}

# 1. HEAD must build a valid database from zero.
CLEAN_DATA="$TMP/clean"
run_migrate "$ROOT" "$CLEAN_DATA" true > "$TMP/clean-migrate.json"
node "$ROOT/scripts/grace-governance.mjs" db-integrity \
  --database "$CLEAN_DATA/kafedra-planner.sqlite3" \
  --migrations-dir "$ROOT/migrations"

# 2. Build an actual database with the exact base revision, then upgrade it using HEAD.
UPGRADE_DATA="$TMP/upgrade"
run_migrate "$BASE_APP" "$UPGRADE_DATA" true > "$TMP/base-migrate.json"
node "$ROOT/scripts/grace-governance.mjs" db-integrity \
  --database "$UPGRADE_DATA/kafedra-planner.sqlite3" \
  --migrations-dir "$BASE_APP/migrations"

KAFEDRA_APPLICATION_DIR="$ROOT" \
KAFEDRA_DATA_DIR="$UPGRADE_DATA" \
KAFEDRA_DATABASE_PATH="$UPGRADE_DATA/kafedra-planner.sqlite3" \
KAFEDRA_BACKUP_DIR="$UPGRADE_DATA/backups" \
KAFEDRA_BACKUP_INCLUDE_APPLICATION=false \
KAFEDRA_AUTO_BACKUP_BEFORE_MIGRATION=true \
KAFEDRA_SKIP_AUTO_BACKUP=false \
  node "$ROOT/scripts/migrate.mjs" > "$TMP/upgrade-migrate.json"

node "$ROOT/scripts/grace-governance.mjs" db-integrity \
  --database "$UPGRADE_DATA/kafedra-planner.sqlite3" \
  --migrations-dir "$ROOT/migrations"

ADDED_MIGRATIONS="$(git diff --name-status "$BASE_REF"...HEAD -- migrations | awk '$1 == "A" {print $2}')"
if [[ -n "$ADDED_MIGRATIONS" ]]; then
  BACKUP="$(node -e 'const fs=require("node:fs"); const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(v.backup || "");' "$TMP/upgrade-migrate.json")"
  if [[ -z "$BACKUP" || ! -f "$BACKUP" ]]; then
    echo "A schema upgrade occurred but migrate.mjs did not produce a pre-migration backup." >&2
    exit 1
  fi

  node "$ROOT/scripts/backup-verify.mjs" "$BACKUP"

  RESTORED_DB="$TMP/restored-base.sqlite3"
  node --input-type=module - "$BACKUP" "$RESTORED_DB" <<'NODE'
import { restoreDatabaseFile } from './packages/backup/src/service.mjs';
const [, , archivePath, targetDatabasePath] = process.argv;
await restoreDatabaseFile({
  archivePath,
  keyFile: null,
  targetDatabasePath,
  apply: true,
  force: true
});
NODE

  node "$ROOT/scripts/grace-governance.mjs" db-integrity \
    --database "$RESTORED_DB" \
    --migrations-dir "$BASE_APP/migrations"
fi

printf 'GRACE database gate passed: base=%s head=%s\n' "$BASE_REF" "$(git rev-parse HEAD)"
