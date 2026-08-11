#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
OUT_DIR="${OUT_DIR:-$ROOT/release}"
WORK_DIR="$(mktemp -d)"
BUNDLE_ROOT="$WORK_DIR/kafedra-planner-$VERSION"
TEMP_ARCHIVE=""
cleanup() {
  local status=$?
  trap - EXIT
  rm -rf "$WORK_DIR"
  if [[ -n "$TEMP_ARCHIVE" ]]; then
    rm -f "$TEMP_ARCHIVE" "$TEMP_ARCHIVE.sha256"
  fi
  exit "$status"
}
trap cleanup EXIT

log() { printf '%s\n' "$*" >&2; }
fail() { log "Ошибка сборки offline bundle: $*"; exit 2; }

for command in tar gzip sha256sum find sort xargs install cp grep head readlink; do
  command -v "$command" >/dev/null 2>&1 || fail "не найдена команда $command"
done

if [[ -n "${NODE_RUNTIME_DIR:-}" ]]; then
  NODE_SOURCE="$NODE_RUNTIME_DIR/bin/node"
elif [[ -n "${NODE_BINARY:-}" ]]; then
  NODE_SOURCE="$NODE_BINARY"
else
  NODE_SOURCE="$(command -v node || true)"
fi
[[ -n "$NODE_SOURCE" && -x "$NODE_SOURCE" ]] || fail "не найден совместимый Node.js; запустите сборку из Node 24.15+ или задайте NODE_RUNTIME_DIR"
NODE_SOURCE="$(readlink -f "$NODE_SOURCE" 2>/dev/null || realpath "$NODE_SOURCE" 2>/dev/null || printf '%s' "$NODE_SOURCE")"
if [[ -n "${NODE_RUNTIME_DIR:-}" ]]; then
  RUNTIME_HOME="$(cd "$NODE_RUNTIME_DIR" && pwd)"
else
  RUNTIME_HOME="$(cd "$(dirname "$NODE_SOURCE")/.." && pwd)"
fi

"$NODE_SOURCE" "$ROOT/scripts/offline/runtime-contract.mjs" inspect \
  --package-json "$ROOT/package.json" \
  --runtime "$NODE_SOURCE" >/dev/null

if command -v ldd >/dev/null 2>&1; then
  LDD_OUTPUT="$(ldd "$NODE_SOURCE" 2>&1 || true)"
  grep -q 'not found' <<<"$LDD_OUTPUT" && fail "runtime содержит неразрешённые динамические зависимости: $LDD_OUTPUT"
  grep -Eq '(^|[[:space:]/])libnode\.so' <<<"$LDD_OUTPUT" && fail "системный node зависит от libnode.so и не является автономным; используйте официальный Linux runtime через NODE_RUNTIME_DIR"
fi

LICENSE_SOURCE="${NODE_LICENSE_FILE:-}"
if [[ -z "$LICENSE_SOURCE" ]]; then
  for candidate in "$RUNTIME_HOME/LICENSE" "$RUNTIME_HOME/LICENSE.md" "$(dirname "$NODE_SOURCE")/../LICENSE"; do
    if [[ -f "$candidate" ]]; then LICENSE_SOURCE="$candidate"; break; fi
  done
fi
[[ -n "$LICENSE_SOURCE" && -f "$LICENSE_SOURCE" ]] || fail "не найдена лицензия Node.js; используйте официальный runtime или задайте NODE_LICENSE_FILE"

mkdir -p "$OUT_DIR" "$BUNDLE_ROOT/application" "$BUNDLE_ROOT/runtime/node/bin"
cp -a \
  "$ROOT/apps" "$ROOT/packages" "$ROOT/public" "$ROOT/migrations" \
  "$ROOT/scripts" "$ROOT/deploy" "$ROOT/docs" "$ROOT/tests" \
  "$ROOT/package.json" "$ROOT/VERSION" "$ROOT/README.md" \
  "$ROOT/SECURITY.md" "$ROOT/.env.example" \
  "$BUNDLE_ROOT/application/"
install -m 0755 "$ROOT/deploy/install.sh" "$BUNDLE_ROOT/install.sh"
install -m 0755 "$NODE_SOURCE" "$BUNDLE_ROOT/runtime/node/bin/node"
install -m 0644 "$LICENSE_SOURCE" "$BUNDLE_ROOT/runtime/node/LICENSE"

GIT_COMMIT="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || printf unknown)"
"$BUNDLE_ROOT/runtime/node/bin/node" \
  "$BUNDLE_ROOT/application/scripts/offline/runtime-contract.mjs" write-release \
  --package-json "$BUNDLE_ROOT/application/package.json" \
  --version-file "$BUNDLE_ROOT/application/VERSION" \
  --runtime "$BUNDLE_ROOT/runtime/node/bin/node" \
  --output "$BUNDLE_ROOT/release.json" \
  --git-commit "$GIT_COMMIT" >/dev/null

UNSUPPORTED_ENTRY="$(find "$BUNDLE_ROOT" ! -type f ! -type d -print -quit)"
[[ -z "$UNSUPPORTED_ENTRY" ]] || fail "release-комплект содержит симлинк или специальный файл: $UNSUPPORTED_ENTRY"
BAD_PATH="$(find "$BUNDLE_ROOT" -print | LC_ALL=C grep -E '[[:cntrl:]\\]' | head -n 1 || true)"
[[ -z "$BAD_PATH" ]] || fail "release-комплект содержит небезопасное имя файла: $BAD_PATH"

(
  cd "$BUNDLE_ROOT"
  LC_ALL=C find . -type f ! -path './manifest.sha256' -print0 \
    | LC_ALL=C sort -z \
    | xargs -0 sha256sum > manifest.sha256
)

ARCHIVE_BASENAME="kafedra-planner-$VERSION.tar.gz"
ARCHIVE="$OUT_DIR/$ARCHIVE_BASENAME"
TEMP_ARCHIVE="$OUT_DIR/.${ARCHIVE_BASENAME}.tmp.$$"
TAR_OPTIONS=(--sort=name --owner=0 --group=0 --numeric-owner)
if [[ -n "${SOURCE_DATE_EPOCH:-}" ]]; then
  TAR_OPTIONS+=(--mtime="@$SOURCE_DATE_EPOCH")
fi
tar "${TAR_OPTIONS[@]}" -C "$WORK_DIR" -cf - "kafedra-planner-$VERSION" | gzip -n -6 > "$TEMP_ARCHIVE"
(
  cd "$OUT_DIR"
  sha256sum "$(basename "$TEMP_ARCHIVE")" > "$(basename "$TEMP_ARCHIVE").sha256"
)

log "Проверка собранного автономного комплекта..."
REQUIRE_ARCHIVE_SHA256=true SKIP_SYSTEM_PREFLIGHT=true \
  "$ROOT/scripts/offline/verify-bundle.sh" "$TEMP_ARCHIVE" >&2
mv -f "$TEMP_ARCHIVE" "$ARCHIVE"
rm -f "$TEMP_ARCHIVE.sha256"
TEMP_ARCHIVE=""
(
  cd "$OUT_DIR"
  sha256sum "$ARCHIVE_BASENAME" > "$ARCHIVE_BASENAME.sha256.tmp"
  mv -f "$ARCHIVE_BASENAME.sha256.tmp" "$ARCHIVE_BASENAME.sha256"
  sha256sum -c --strict "$ARCHIVE_BASENAME.sha256" >/dev/null
)
log "Offline bundle собран: $ARCHIVE ($(du -h "$ARCHIVE" | awk '{print $1}'))"
printf '%s\n' "$ARCHIVE"
