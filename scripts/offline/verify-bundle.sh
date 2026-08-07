#!/usr/bin/env bash
set -Eeuo pipefail

ARCHIVE="${1:-}"
[[ -n "$ARCHIVE" && -f "$ARCHIVE" ]] || { echo "Использование: $0 <bundle.tar.gz>" >&2; exit 2; }
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

CHECKSUM_FILE="$ARCHIVE.sha256"
if [[ -f "$CHECKSUM_FILE" ]]; then
  (
    cd "$(dirname "$ARCHIVE")"
    sha256sum -c "$(basename "$CHECKSUM_FILE")"
  )
elif [[ "${REQUIRE_ARCHIVE_SHA256:-false}" == "true" ]]; then
  echo "Рядом с архивом отсутствует $(basename "$CHECKSUM_FILE")" >&2
  exit 3
fi

LIST_FILE="$WORK_DIR/archive-list.txt"
VERBOSE_LIST_FILE="$WORK_DIR/archive-verbose-list.txt"
tar -tzf "$ARCHIVE" > "$LIST_FILE"
tar -tvzf "$ARCHIVE" > "$VERBOSE_LIST_FILE"
[[ -s "$LIST_FILE" && -s "$VERBOSE_LIST_FILE" ]] || { echo "Архив пуст" >&2; exit 4; }

while IFS= read -r line; do
  entry_type="${line:0:1}"
  case "$entry_type" in
    '-'|'d') ;;
    *)
      echo "Неподдерживаемый тип записи в release-архиве: $entry_type" >&2
      exit 5
      ;;
  esac
done < "$VERBOSE_LIST_FILE"

while IFS= read -r entry; do
  clean="${entry#./}"
  if [[ "$clean" == /* || "$clean" == ".." || "$clean" == ../* || "$clean" == */../* || "$clean" == */.. ]]; then
    echo "Небезопасный путь в архиве: $entry" >&2
    exit 6
  fi
done < "$LIST_FILE"
mapfile -t TOP_LEVEL < <(sed 's#^\./##; s#/.*##' "$LIST_FILE" | sed '/^$/d' | sort -u)
[[ "${#TOP_LEVEL[@]}" -eq 1 ]] || { echo "Архив должен содержать ровно один корневой каталог" >&2; exit 7; }

tar -xzf "$ARCHIVE" -C "$WORK_DIR"
ROOT="$WORK_DIR/${TOP_LEVEL[0]}"
[[ -d "$ROOT" && -f "$ROOT/manifest.sha256" && -f "$ROOT/release.json" ]] || { echo "Комплект неполон" >&2; exit 8; }
(
  cd "$ROOT"
  sha256sum -c manifest.sha256
)

EMBEDDED_NODE="$ROOT/runtime/node/bin/node"
if [[ -x "$EMBEDDED_NODE" ]]; then
  NODE="$EMBEDDED_NODE"
elif [[ "${REQUIRE_EMBEDDED_RUNTIME:-false}" == "true" ]]; then
  echo "В release-комплекте отсутствует встроенный runtime/node/bin/node" >&2
  exit 9
else
  NODE="$(command -v node || true)"
fi
[[ -n "$NODE" ]] || { echo "Нет встроенного или системного Node.js" >&2; exit 10; }

"$NODE" - "$ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const release = JSON.parse(fs.readFileSync(path.join(root, 'release.json'), 'utf8'));
const version = fs.readFileSync(path.join(root, 'application', 'VERSION'), 'utf8').trim();
if (release.name !== 'kafedra-planner') throw new Error('release_name_mismatch');
if (release.version !== version) throw new Error('release_version_mismatch');
const embedded = fs.existsSync(path.join(root, 'runtime', 'node', 'bin', 'node'));
if (Boolean(release.nodeRuntimeIncluded) !== embedded) throw new Error('release_runtime_flag_mismatch');
if (embedded) {
  if (release.nodeVersion !== process.version) throw new Error('release_node_version_mismatch');
  if (release.nodePlatform !== process.platform) throw new Error('release_node_platform_mismatch');
  if (release.nodeArch !== process.arch) throw new Error('release_node_arch_mismatch');
  const major = Number(process.versions.node.split('.')[0]);
  if (major !== 24) throw new Error('release_node_major_mismatch');
}
process.stdout.write(`${JSON.stringify({
  version,
  embeddedRuntime: embedded,
  nodeVersion: process.version,
  platform: process.platform,
  arch: process.arch
})}\n`);
NODE

if [[ "${REQUIRE_EMBEDDED_RUNTIME:-false}" == "true" ]]; then
  [[ "$NODE" == "$EMBEDDED_NODE" ]] || { echo "Smoke должен выполняться встроенным Node.js" >&2; exit 11; }
fi

"$NODE" --version
(
  cd "$ROOT/application"
  KAFEDRA_DATA_DIR="$WORK_DIR/data" "$NODE" scripts/smoke-test.mjs
  PREFLIGHT_ARGS=(--json)
  if [[ "${REQUIRE_SYSTEM_PREFLIGHT:-false}" == "true" ]]; then
    PREFLIGHT_ARGS+=(--strict)
  fi
  if [[ "${REQUIRE_FULL_SYSTEM_PREFLIGHT:-false}" == "true" ]]; then
    PREFLIGHT_ARGS+=(--require-full)
  fi
  "$NODE" scripts/system-preflight.mjs "${PREFLIGHT_ARGS[@]}"
)
echo "Целостность и запуск автономного комплекта проверены. Состояние системных возможностей показано preflight выше."
