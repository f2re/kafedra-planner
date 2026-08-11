#!/usr/bin/env bash
set -Eeuo pipefail

ARCHIVE="${1:-}"
[[ -n "$ARCHIVE" && -f "$ARCHIVE" ]] || { echo "Использование: $0 <bundle.tar.gz>" >&2; exit 2; }
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

CHECKSUM_FILE="$ARCHIVE.sha256"
if [[ -f "$CHECKSUM_FILE" ]]; then
  ( cd "$(dirname "$ARCHIVE")"; sha256sum -c --strict "$(basename "$CHECKSUM_FILE")" )
elif [[ "${REQUIRE_ARCHIVE_SHA256:-true}" != "false" ]]; then
  echo "Рядом с архивом отсутствует $(basename "$CHECKSUM_FILE")" >&2; exit 3
fi

LIST_FILE="$WORK_DIR/archive-list.txt"
VERBOSE_LIST_FILE="$WORK_DIR/archive-verbose-list.txt"
tar -tzf "$ARCHIVE" > "$LIST_FILE"
tar -tvzf "$ARCHIVE" > "$VERBOSE_LIST_FILE"
[[ -s "$LIST_FILE" && -s "$VERBOSE_LIST_FILE" ]] || { echo "Архив пуст" >&2; exit 4; }
while IFS= read -r line; do
  entry_type="${line:0:1}"
  case "$entry_type" in '-'|'d') ;; *) echo "Неподдерживаемый тип записи в release-архиве: $entry_type" >&2; exit 5 ;; esac
done < "$VERBOSE_LIST_FILE"
while IFS= read -r entry; do
  clean="${entry#./}"
  if [[ "$clean" == /* || "$clean" == ".." || "$clean" == ../* || "$clean" == */../* || "$clean" == */.. ]]; then echo "Небезопасный путь в архиве: $entry" >&2; exit 6; fi
  if [[ "$entry" =~ [[:cntrl:]\\] ]]; then echo "Неподдерживаемое имя файла в архиве: $entry" >&2; exit 6; fi
done < "$LIST_FILE"
mapfile -t TOP_LEVEL < <(sed 's#^\./##; s#/.*##' "$LIST_FILE" | sed '/^$/d' | sort -u)
[[ "${#TOP_LEVEL[@]}" -eq 1 ]] || { echo "Архив должен содержать ровно один корневой каталог" >&2; exit 7; }

tar -xzf "$ARCHIVE" -C "$WORK_DIR"
ROOT="$WORK_DIR/${TOP_LEVEL[0]}"
REQUIRED_FILES=(manifest.sha256 release.json install.sh runtime/node/bin/node runtime/node/LICENSE application/package.json application/VERSION application/apps/api/src/main.mjs application/apps/worker/src/main.mjs application/scripts/smoke-test.mjs application/scripts/system-preflight.mjs application/scripts/offline/runtime-contract.mjs application/deploy/systemd/kafedra-planner-api.service application/deploy/systemd/kafedra-planner-worker.service)
for relative_path in "${REQUIRED_FILES[@]}"; do [[ -f "$ROOT/$relative_path" ]] || { echo "Комплект неполон: отсутствует $relative_path" >&2; exit 8; }; done
for relative_dir in application/packages application/public application/migrations application/docs; do [[ -d "$ROOT/$relative_dir" ]] || { echo "Комплект неполон: отсутствует каталог $relative_dir" >&2; exit 8; }; done
[[ -x "$ROOT/install.sh" && -x "$ROOT/runtime/node/bin/node" ]] || { echo "Установщик или встроенный Node.js не исполняемый" >&2; exit 8; }
FULL_BUNDLE=false
if [[ -f "$ROOT/deployment.json" ]]; then
  FULL_BUNDLE=true
  FULL_REQUIRED=(runtime/python/python runtime/python/runtime.json os-packages/manifest.sha256 os-packages/packages.tsv os-packages/requested-packages.txt os-packages/source-os.env application/scripts/recognition/ocr.py application/scripts/offline/deployment-contract.mjs application/scripts/offline/install-os-packages.sh)
  for relative_path in "${FULL_REQUIRED[@]}"; do [[ -f "$ROOT/$relative_path" ]] || { echo "Full bundle неполон: отсутствует $relative_path" >&2; exit 8; }; done
  [[ -x "$ROOT/runtime/python/python" ]] || { echo "Managed Python не исполняемый" >&2; exit 8; }
fi

MANIFEST_PATHS="$WORK_DIR/manifest-paths.txt"
ACTUAL_PATHS="$WORK_DIR/actual-paths.txt"
while IFS= read -r line; do
  [[ "$line" =~ ^[0-9a-fA-F]{64}[[:space:]][\ \*](\./)?(.+)$ ]] || { echo "Некорректная строка manifest.sha256" >&2; exit 9; }
  path="${BASH_REMATCH[2]}"
  if [[ "$path" == /* || "$path" == ".." || "$path" == ../* || "$path" == */../* || "$path" == */.. || "$path" =~ [[:cntrl:]\\] ]]; then echo "Небезопасный путь в manifest.sha256: $path" >&2; exit 9; fi
  printf '%s\n' "$path"
done < "$ROOT/manifest.sha256" | LC_ALL=C sort > "$MANIFEST_PATHS"
DUPLICATE="$(uniq -d "$MANIFEST_PATHS" | head -n 1 || true)"
[[ -z "$DUPLICATE" ]] || { echo "Повтор пути в manifest.sha256: $DUPLICATE" >&2; exit 9; }
( cd "$ROOT"; LC_ALL=C find . -type f ! -path './manifest.sha256' -printf '%P\n' | LC_ALL=C sort ) > "$ACTUAL_PATHS"
cmp -s "$MANIFEST_PATHS" "$ACTUAL_PATHS" || { echo "manifest.sha256 не перечисляет в точности все файлы комплекта" >&2; diff -u "$MANIFEST_PATHS" "$ACTUAL_PATHS" >&2 || true; exit 9; }
if ! ( cd "$ROOT"; sha256sum -c --strict manifest.sha256 ) > "$WORK_DIR/manifest-check.txt" 2>&1; then cat "$WORK_DIR/manifest-check.txt" >&2; exit 9; fi
echo "Внутренний manifest: OK ($(wc -l < "$MANIFEST_PATHS") файлов)"
EMBEDDED_NODE="$ROOT/runtime/node/bin/node"
"$EMBEDDED_NODE" "$ROOT/application/scripts/offline/runtime-contract.mjs" verify-bundle --root "$ROOT"
"$EMBEDDED_NODE" --version
if [[ "$FULL_BUNDLE" == true ]]; then
  "$EMBEDDED_NODE" "$ROOT/application/scripts/offline/deployment-contract.mjs" verify --root "$ROOT" >/dev/null
  source "$ROOT/application/scripts/offline/lib.sh"
  verify_os_package_set "$ROOT/os-packages" 0
  "$ROOT/runtime/python/python" -c "from pathlib import Path; p=Path('$ROOT/application/scripts/recognition/ocr.py'); compile(p.read_text(encoding='utf-8'),str(p),'exec')"
  echo "Профиль full: managed Python и набор пакетов ОС проверены."
fi
(
  cd "$ROOT/application"
  KAFEDRA_DATA_DIR="$WORK_DIR/data" "$EMBEDDED_NODE" scripts/smoke-test.mjs
  if [[ "${SKIP_SYSTEM_PREFLIGHT:-false}" != "true" ]]; then
    PREFLIGHT_ARGS=(--json)
    [[ "${REQUIRE_SYSTEM_PREFLIGHT:-false}" != "true" ]] || PREFLIGHT_ARGS+=(--strict)
    [[ "${REQUIRE_FULL_SYSTEM_PREFLIGHT:-false}" != "true" ]] || PREFLIGHT_ARGS+=(--require-full)
    "$EMBEDDED_NODE" scripts/system-preflight.mjs "${PREFLIGHT_ARGS[@]}"
  fi
)
echo "Целостность, полнота и запуск автономного комплекта проверены встроенным Node.js."
