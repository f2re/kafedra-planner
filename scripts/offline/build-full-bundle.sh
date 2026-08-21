#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$SCRIPT_DIR/lib.sh"
OUT_DIR="${OUT_DIR:-$ROOT/release}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
REUSE_OS=false
APT_UPDATE=false
while (($#)); do
  case "$1" in
    --output) OUT_DIR="$2"; shift 2 ;;
    --python) PYTHON_BIN="$2"; shift 2 ;;
    --reuse-os-packages) REUSE_OS=true; shift ;;
    --refresh-os-packages) REUSE_OS=false; shift ;;
    --apt-update) APT_UPDATE=true; REUSE_OS=false; shift ;;
    -h|--help)
      cat <<'HELP'
Использование: npm run bundle:offline -- [--output DIR] [--python PYTHON] [--reuse-os-packages] [--apt-update]

Собирает полный target-specific offline bundle на эталонной Debian/Astra Linux
той же версии и архитектуры, что целевая машина. Внутри: приложение, Node.js,
managed CPython для распознавания и автономный .deb fallback для OCR/Poppler/
LibreOffice. По умолчанию package layer пересобирается из текущих APT indexes,
чтобы release не наследовал устаревшие версии из старого cache.

--reuse-os-packages разрешает повторно использовать только проверенный cache,
если его requested-packages.txt точно совпадает с текущим package profile.
Целевой installer никогда не передаёт APT package=version: версии inventory
нужны только для контроля целостности автономного fallback.
HELP
      exit 0 ;;
    *) die "Неизвестный параметр: $1" ;;
  esac
done
for command in awk cmp dpkg sed sha256sum sort tar "$PYTHON_BIN"; do require_command "$command"; done
mapfile -t profile < <(detect_os_profile /etc/os-release)
[[ "${profile[0]}" == astra || "${profile[1]}" == debian ]] || die "Полный bundle собирается только на эталонной Debian/Astra Linux той же версии, что target"
[[ "${profile[3]}" == amd64 || "${profile[3]}" == arm64 ]] || die "Поддерживаются amd64/arm64, получено ${profile[3]}"
PROFILE_TAG="${profile[0]}-${profile[2]}-${profile[3]}"
PROFILE_TAG="$(printf '%s' "$PROFILE_TAG" | sed -E 's/[^A-Za-z0-9._-]+/_/g')"
BUNDLE_TAG="$PROFILE_TAG"
if [[ -n "${KAFEDRA_FULL_BUNDLE_TAG_SUFFIX:-}" ]]; then
  [[ "$KAFEDRA_FULL_BUNDLE_TAG_SUFFIX" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die "Небезопасный suffix bundle: $KAFEDRA_FULL_BUNDLE_TAG_SUFFIX"
  BUNDLE_TAG="$BUNDLE_TAG-$KAFEDRA_FULL_BUNDLE_TAG_SUFFIX"
fi
CACHE_ROOT="${KAFEDRA_FULL_BUNDLE_CACHE_DIR:-${XDG_CACHE_HOME:-${HOME:-$ROOT}/.cache}/kafedra-planner}"
PYTHON_RUNTIME_DIR="${KAFEDRA_PYTHON_RUNTIME_DIR:-$CACHE_ROOT/python/$PROFILE_TAG}"
OS_PACKAGES_DIR="${KAFEDRA_OS_PACKAGES_DIR:-$CACHE_ROOT/os-packages/$PROFILE_TAG}"
PACKAGE_LIST="${KAFEDRA_OS_PACKAGE_LIST:-$ROOT/config/offline/os-packages.txt}"
python_runtime_ok() { [[ -x "$PYTHON_RUNTIME_DIR/python" && -f "$PYTHON_RUNTIME_DIR/runtime.json" ]] || return 1; "$PYTHON_RUNTIME_DIR/python" -c 'import json,sqlite3,ssl,sys; print(json.dumps(list(sys.version_info[:3])))' >/dev/null 2>&1; }
normalized_package_list() { sed -E 's/[[:space:]]*#.*$//' "$PACKAGE_LIST" | awk 'NF { $1=$1; print }' | LC_ALL=C sort -u; }
package_cache_matches_profile() {
  [[ -d "$OS_PACKAGES_DIR" ]] || return 1
  verify_os_package_set "$OS_PACKAGES_DIR" 1 >/dev/null 2>&1 || return 1
  cmp -s <(normalized_package_list) "$OS_PACKAGES_DIR/requested-packages.txt"
}
if ! python_runtime_ok; then rm -rf "$PYTHON_RUNTIME_DIR"; mkdir -p "$(dirname "$PYTHON_RUNTIME_DIR")"; info "Экспортируем managed CPython для распознавания: $PYTHON_BIN"; "$PYTHON_BIN" "$SCRIPT_DIR/python-runtime.py" export --destination "$PYTHON_RUNTIME_DIR" >/dev/null; fi
python_runtime_ok || die "Managed Python runtime не прошёл самопроверку"

if [[ "$REUSE_OS" == true ]]; then
  package_cache_matches_profile || die "OS package cache устарел или не соответствует текущему config/offline/os-packages.txt; пересоберите без --reuse-os-packages"
  info "Используем явно разрешённый OS package cache: $OS_PACKAGES_DIR"
else
  rm -rf "$OS_PACKAGES_DIR"
  args=(--package-list "$PACKAGE_LIST" --output "$OS_PACKAGES_DIR")
  if [[ "$APT_UPDATE" == true ]]; then
    [[ "${EUID:-$(id -u)}" -eq 0 ]] || die "--apt-update требует root; выполните sudo apt-get update отдельно или запустите сборку от root"
    args+=(--apt-update)
  fi
  "$SCRIPT_DIR/collect-os-packages.sh" "${args[@]}" >/dev/null
fi
verify_os_package_set "$OS_PACKAGES_DIR" 1
mkdir -p "$OUT_DIR"
info "Собираем полный offline bundle для ${profile[0]} ${profile[2]} ${profile[3]}"
ARCHIVE="$({ PYTHON_RUNTIME_DIR="$PYTHON_RUNTIME_DIR" OS_PACKAGES_DIR="$OS_PACKAGES_DIR" REQUIRE_FULL_BUNDLE=true FULL_BUNDLE_TAG="$BUNDLE_TAG" OUT_DIR="$OUT_DIR" "$SCRIPT_DIR/build-bundle.sh"; } | tail -n 1)"
[[ -f "$ARCHIVE" && -f "$ARCHIVE.sha256" ]] || die "Сборщик не создал archive+sha256"
ARCHIVE_BASENAME="$(basename "$ARCHIVE")"; WRAPPER="$OUT_DIR/install-kafedra-planner.sh"
"$PYTHON_BIN" - "$SCRIPT_DIR/install-from-archive.sh" "$WRAPPER" "$ARCHIVE_BASENAME" <<'PY_WRAPPER'
from pathlib import Path
import sys
source=Path(sys.argv[1]).read_text()
archive=sys.argv[3]
source=source.replace('ARCHIVE="${1:-}"', 'ARCHIVE="${1:-$SCRIPT_DIR/%s}"' % archive, 1)
Path(sys.argv[2]).write_text(source)
PY_WRAPPER
chmod 0755 "$WRAPPER"
cat > "$OUT_DIR/README-INSTALL.txt" <<EOF_README
KAFEDRA PLANNER — ПОЛНАЯ АВТОНОМНАЯ УСТАНОВКА

Комплект собран для: ${profile[0]} / ${profile[1]} ${profile[2]} / ${profile[3]}.
Скопируйте в один каталог три обязательных файла:
  $ARCHIVE_BASENAME
  $ARCHIVE_BASENAME.sha256
  install-kafedra-planner.sh

Установка или безопасное обновление одной командой:
  sudo ./install-kafedra-planner.sh

Установщик:
  • проверит SHA-256 и внутренний manifest;
  • не фиксирует версии пакетов: сначала выполняет обычный apt-get install по именам пакетов из штатных sources целевой ОС;
  • до изменения dpkg полностью проверяет и скачивает штатный APT-план; при недоступных sources автоматически переходит на локальный .deb fallback из bundle;
  • для принудительно изолированной установки поддерживает KAFEDRA_APT_MODE=bundle;
  • никогда автоматически не вызывает apt --fix-broken и не продолжает работу с уже повреждённой package database;
  • проверит Tesseract rus+eng, Poppler, LibreOffice и managed Python;
  • создаст/обновит приложение, выполнит миграции и rollback при ошибке;
  • при первой установке создаст администратора и root-only файл первого входа;
  • запустит API и worker, откроет доступ по LAN и выполнит итоговый doctor.

Интернет на target не обязателен: если штатные APT sources недоступны, используется
самодостаточный локальный repository из этого же bundle.
EOF_README
info "Готово: $ARCHIVE ($(du -h "$ARCHIVE" | awk '{print $1}'))"
info "Установка на target: sudo ./install-kafedra-planner.sh"
printf '%s\n' "$ARCHIVE"
