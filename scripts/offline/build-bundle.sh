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

for command in tar gzip sha256sum find sort xargs install cp grep head readlink awk mktemp; do
  command -v "$command" >/dev/null 2>&1 || fail "не найдена команда $command"
done

HOST_NODE="$(command -v node || true)"
[[ -n "$HOST_NODE" && -x "$HOST_NODE" ]] || fail "для запуска сборщика требуется Node.js; версия host Node не обязана совпадать с runtime поставки"
HOST_PLATFORM="$($HOST_NODE -p 'process.platform')"
HOST_ARCH="$($HOST_NODE -p 'process.arch')"
[[ "$HOST_PLATFORM" == "linux" ]] || fail "сборка Linux offline bundle поддерживается только на Linux host, получено: $HOST_PLATFORM"
[[ "$HOST_ARCH" == "x64" || "$HOST_ARCH" == "arm64" ]] || fail "неподдерживаемая архитектура host: $HOST_ARCH"

readarray -t TARGET_RUNTIME_POLICY < <("$HOST_NODE" - "$ROOT/package.json" "$HOST_ARCH" <<'NODE'
const fs = require('node:fs');
const pkg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const arch = process.argv[3];
const policy = pkg?.kafedra?.offlineRuntime;
const version = String(policy?.node || '').trim().replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(version)) process.exit(2);
const key = `linux-${arch}`;
const archive = policy?.archives?.[key];
if (!archive || typeof archive.file !== 'string' || !archive.file.trim()) process.exit(3);
if (typeof archive.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(archive.sha256)) process.exit(4);
process.stdout.write(`${version}\n${String(policy?.distBaseUrl || 'https://nodejs.org/dist').replace(/\/+$/, '')}\n${archive.file}\n${archive.sha256.toLowerCase()}\n`);
NODE
) || fail "не удалось определить политику kafedra.offlineRuntime для linux-$HOST_ARCH из package.json"
TARGET_NODE_VERSION="${TARGET_RUNTIME_POLICY[0]:-}"
TARGET_NODE_DIST_BASE="${NODE_DIST_BASE_URL:-${TARGET_RUNTIME_POLICY[1]:-https://nodejs.org/dist}}"
TARGET_NODE_ARCHIVE="${TARGET_RUNTIME_POLICY[2]:-}"
TARGET_NODE_ARCHIVE_SHA256="${TARGET_RUNTIME_POLICY[3]:-}"
[[ -n "$TARGET_NODE_VERSION" && -n "$TARGET_NODE_ARCHIVE" && -n "$TARGET_NODE_ARCHIVE_SHA256" ]] || fail "политика offline runtime неполна"
if [[ -n "${XDG_CACHE_HOME:-}" ]]; then
  DEFAULT_CACHE_HOME="$XDG_CACHE_HOME"
elif [[ -n "${HOME:-}" ]]; then
  DEFAULT_CACHE_HOME="$HOME/.cache"
else
  DEFAULT_CACHE_HOME="$ROOT/.cache"
fi
RUNTIME_CACHE_ROOT="${KAFEDRA_RUNTIME_CACHE_DIR:-$DEFAULT_CACHE_HOME/kafedra-planner/node}"

candidate_license() {
  local runtime="$1" home
  home="$(cd "$(dirname "$runtime")/.." && pwd)"
  for candidate in "${NODE_LICENSE_FILE:-}" "$home/LICENSE" "$home/LICENSE.md"; do
    if [[ -n "$candidate" && -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

runtime_has_external_libnode() {
  local runtime="$1" output
  command -v ldd >/dev/null 2>&1 || return 1
  output="$(ldd "$runtime" 2>&1 || true)"
  grep -Eq '(^|[[:space:]/])libnode\.so' <<<"$output"
}

runtime_is_usable() {
  local runtime="$1"
  [[ -x "$runtime" ]] || return 1
  candidate_license "$runtime" >/dev/null || return 1
  runtime_has_external_libnode "$runtime" && return 1
  "$runtime" "$ROOT/scripts/offline/runtime-contract.mjs" inspect \
    --package-json "$ROOT/package.json" --runtime "$runtime" >/dev/null 2>&1
}

download_file() {
  local url="$1" output="$2"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --silent --show-error --retry 3 --connect-timeout 15 --output "$output" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -q --tries=3 --timeout=30 -O "$output" "$url"
  else
    fail "для автоматической загрузки Node.js нужен curl или wget; либо задайте NODE_RUNTIME_DIR"
  fi
}

prepare_cached_runtime() {
  local cache_dir="$1" release_url download_dir extracted
  release_url="${TARGET_NODE_DIST_BASE}/v${TARGET_NODE_VERSION}"
  download_dir="$WORK_DIR/node-download"
  extracted="$download_dir/node-v${TARGET_NODE_VERSION}-linux-${HOST_ARCH}"
  mkdir -p "$download_dir" "$cache_dir/bin"

  log "Host Node.js: $($HOST_NODE --version); runtime поставки: v$TARGET_NODE_VERSION. Загружаю закреплённый официальный Node.js runtime..."
  download_file "$release_url/$TARGET_NODE_ARCHIVE" "$download_dir/$TARGET_NODE_ARCHIVE"
  printf '%s  %s\n' "$TARGET_NODE_ARCHIVE_SHA256" "$TARGET_NODE_ARCHIVE" > "$download_dir/runtime.sha256"
  (
    cd "$download_dir"
    sha256sum -c --strict runtime.sha256 >/dev/null
  ) || fail "SHA-256 Node.js runtime не совпадает с закреплённым digest из package.json"
  tar -xzf "$download_dir/$TARGET_NODE_ARCHIVE" -C "$download_dir"
  [[ -x "$extracted/bin/node" && -f "$extracted/LICENSE" ]] || fail "официальный архив Node.js имеет неожиданную структуру"

  install -m 0755 "$extracted/bin/node" "$cache_dir/bin/node.tmp"
  install -m 0644 "$extracted/LICENSE" "$cache_dir/LICENSE.tmp"
  mv -f "$cache_dir/bin/node.tmp" "$cache_dir/bin/node"
  mv -f "$cache_dir/LICENSE.tmp" "$cache_dir/LICENSE"
}

EXPLICIT_RUNTIME=false
if [[ -n "${NODE_RUNTIME_DIR:-}" ]]; then
  EXPLICIT_RUNTIME=true
  NODE_SOURCE="$NODE_RUNTIME_DIR/bin/node"
elif [[ -n "${NODE_BINARY:-}" ]]; then
  EXPLICIT_RUNTIME=true
  NODE_SOURCE="$NODE_BINARY"
else
  NODE_SOURCE="$(readlink -f "$HOST_NODE" 2>/dev/null || realpath "$HOST_NODE" 2>/dev/null || printf '%s' "$HOST_NODE")"
  if ! runtime_is_usable "$NODE_SOURCE"; then
    CACHE_DIR="$RUNTIME_CACHE_ROOT/v${TARGET_NODE_VERSION}/linux-${HOST_ARCH}"
    NODE_SOURCE="$CACHE_DIR/bin/node"
    if ! runtime_is_usable "$NODE_SOURCE"; then
      rm -rf "$CACHE_DIR"
      prepare_cached_runtime "$CACHE_DIR"
    fi
  fi
fi

NODE_SOURCE="$(readlink -f "$NODE_SOURCE" 2>/dev/null || realpath "$NODE_SOURCE" 2>/dev/null || printf '%s' "$NODE_SOURCE")"
[[ -n "$NODE_SOURCE" && -x "$NODE_SOURCE" ]] || fail "не найден runtime Node.js v$TARGET_NODE_VERSION"
if ! runtime_is_usable "$NODE_SOURCE"; then
  if [[ "$EXPLICIT_RUNTIME" == true ]]; then
    fail "NODE_RUNTIME_DIR/NODE_BINARY не соответствует закреплённому runtime v$TARGET_NODE_VERSION и engines.node"
  fi
  fail "подготовленный runtime Node.js v$TARGET_NODE_VERSION не прошёл контракт"
fi

if command -v ldd >/dev/null 2>&1; then
  LDD_OUTPUT="$(ldd "$NODE_SOURCE" 2>&1 || true)"
  grep -q 'not found' <<<"$LDD_OUTPUT" && fail "runtime содержит неразрешённые динамические зависимости: $LDD_OUTPUT"
  grep -Eq '(^|[[:space:]/])libnode\.so' <<<"$LDD_OUTPUT" && fail "runtime зависит от libnode.so и не является автономным"
fi

LICENSE_SOURCE="$(candidate_license "$NODE_SOURCE" || true)"
[[ -n "$LICENSE_SOURCE" && -f "$LICENSE_SOURCE" ]] || fail "не найдена лицензия Node.js"

GIT_COMMIT="unknown"
if command -v git >/dev/null 2>&1 && git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  DIRTY_TREE="$(git -C "$ROOT" status --porcelain --untracked-files=normal)"
  if [[ -n "$DIRTY_TREE" && "${ALLOW_DIRTY_BUNDLE:-false}" != "true" ]]; then
    fail "рабочее дерево содержит незакоммиченные изменения; release должен однозначно соответствовать commit (для диагностической сборки: ALLOW_DIRTY_BUNDLE=true)"
  fi
  if [[ -z "$DIRTY_TREE" ]]; then
    GIT_COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
  else
    log "Внимание: разрешена диагностическая сборка из грязного дерева; gitCommit будет unknown."
  fi
fi

mkdir -p "$OUT_DIR" "$BUNDLE_ROOT/application" "$BUNDLE_ROOT/runtime/node/bin"
cp -a \
  "$ROOT/apps" "$ROOT/packages" "$ROOT/public" "$ROOT/migrations" \
  "$ROOT/scripts" "$ROOT/deploy" "$ROOT/docs" "$ROOT/tests" \
  "$ROOT/package.json" "$ROOT/VERSION" "$ROOT/README.md" \
  "$ROOT/SECURITY.md" "$ROOT/.env.example" \
  "$BUNDLE_ROOT/application/"
[[ ! -f "$ROOT/package-lock.json" ]] || cp -a "$ROOT/package-lock.json" "$BUNDLE_ROOT/application/"
[[ ! -f "$ROOT/.nvmrc" ]] || cp -a "$ROOT/.nvmrc" "$BUNDLE_ROOT/application/"
install -m 0755 "$ROOT/deploy/install.sh" "$BUNDLE_ROOT/install.sh"
install -m 0755 "$NODE_SOURCE" "$BUNDLE_ROOT/runtime/node/bin/node"
install -m 0644 "$LICENSE_SOURCE" "$BUNDLE_ROOT/runtime/node/LICENSE"

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
log "Offline bundle собран: $ARCHIVE ($(du -h "$ARCHIVE" | awk '{print $1}')); runtime Node.js v$TARGET_NODE_VERSION"
printf '%s\n' "$ARCHIVE"
