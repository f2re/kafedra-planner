#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$SCRIPT_DIR/lib.sh"
OUT_DIR="${OUT_DIR:-$ROOT/release}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
REFRESH_OS=false
APT_UPDATE=false
while (($#)); do
  case "$1" in
    --output) OUT_DIR="$2"; shift 2 ;;
    --python) PYTHON_BIN="$2"; shift 2 ;;
    --refresh-os-packages) REFRESH_OS=true; shift ;;
    --apt-update) APT_UPDATE=true; REFRESH_OS=true; shift ;;
    -h|--help)
      cat <<'HELP'
Использование: npm run bundle:offline -- [--output DIR] [--python PYTHON] [--refresh-os-packages] [--apt-update]

Собирает полный target-specific offline bundle на эталонной Debian/Astra Linux
той же версии и архитектуры, что целевая машина. Внутри: приложение, Node.js,
managed CPython для распознавания и полное замыкание .deb для OCR/Poppler/
LibreOffice. Целевая установка не обращается к сети; reverse proxy опционален.
HELP
      exit 0 ;;
    *) die "Неизвестный параметр: $1" ;;
  esac
done
for command in dpkg sha256sum tar "$PYTHON_BIN"; do require_command "$command"; done
mapfile -t profile < <(detect_os_profile /etc/os-release)
[[ "${profile[0]}" == astra || "${profile[1]}" == debian ]] || die "Полный bundle собирается только на эталонной Debian/Astra Linux той же версии, что target"
[[ "${profile[3]}" == amd64 || "${profile[3]}" == arm64 ]] || die "Поддерживаются amd64/arm64, получено ${profile[3]}"
PROFILE_TAG="${profile[0]}-${profile[2]}-${profile[3]}"
PROFILE_TAG="$(printf '%s' "$PROFILE_TAG" | sed -E 's/[^A-Za-z0-9._-]+/_/g')"
CACHE_ROOT="${KAFEDRA_FULL_BUNDLE_CACHE_DIR:-${XDG_CACHE_HOME:-${HOME:-$ROOT}/.cache}/kafedra-planner}"
PYTHON_RUNTIME_DIR="${KAFEDRA_PYTHON_RUNTIME_DIR:-$CACHE_ROOT/python/$PROFILE_TAG}"
OS_PACKAGES_DIR="${KAFEDRA_OS_PACKAGES_DIR:-$CACHE_ROOT/os-packages/$PROFILE_TAG}"
python_runtime_ok() { [[ -x "$PYTHON_RUNTIME_DIR/python" && -f "$PYTHON_RUNTIME_DIR/runtime.json" ]] || return 1; "$PYTHON_RUNTIME_DIR/python" -c 'import json,sqlite3,ssl,sys; print(json.dumps(list(sys.version_info[:3])))' >/dev/null 2>&1; }
if ! python_runtime_ok; then rm -rf "$PYTHON_RUNTIME_DIR"; mkdir -p "$(dirname "$PYTHON_RUNTIME_DIR")"; info "Экспортируем managed CPython для распознавания: $PYTHON_BIN"; "$PYTHON_BIN" "$SCRIPT_DIR/python-runtime.py" export --destination "$PYTHON_RUNTIME_DIR" >/dev/null; fi
python_runtime_ok || die "Managed Python runtime не прошёл самопроверку"
packages_ok=false
if [[ "$REFRESH_OS" == false && -d "$OS_PACKAGES_DIR" ]]; then if verify_os_package_set "$OS_PACKAGES_DIR" 1 >/dev/null 2>&1; then packages_ok=true; fi; fi
if [[ "$packages_ok" == false ]]; then
  rm -rf "$OS_PACKAGES_DIR"; args=(--output "$OS_PACKAGES_DIR")
  if [[ "$APT_UPDATE" == true ]]; then [[ "${EUID:-$(id -u)}" -eq 0 ]] || die "--apt-update требует root; выполните sudo apt-get update отдельно или запустите сборку от root"; args+=(--apt-update); fi
  "$SCRIPT_DIR/collect-os-packages.sh" "${args[@]}" >/dev/null
fi
verify_os_package_set "$OS_PACKAGES_DIR" 1
mkdir -p "$OUT_DIR"
info "Собираем полный offline bundle для ${profile[0]} ${profile[2]} ${profile[3]}"
ARCHIVE="$({ PYTHON_RUNTIME_DIR="$PYTHON_RUNTIME_DIR" OS_PACKAGES_DIR="$OS_PACKAGES_DIR" REQUIRE_FULL_BUNDLE=true FULL_BUNDLE_TAG="$PROFILE_TAG" OUT_DIR="$OUT_DIR" "$SCRIPT_DIR/build-bundle.sh"; } | tail -n 1)"
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

Установщик без сети:
  • проверит SHA-256 и внутренний manifest;
  • установит только .deb из bundle (APT download запрещён);
  • проверит Tesseract rus+eng, Poppler, LibreOffice и managed Python;
  • создаст/обновит приложение, выполнит миграции и rollback при ошибке;
  • при первой установке создаст администратора и root-only файл первого входа;
  • запустит API и worker, откроет доступ по LAN и выполнит итоговый doctor.
EOF_README
info "Готово: $ARCHIVE ($(du -h "$ARCHIVE" | awk '{print $1}'))"
info "Установка на target: sudo ./install-kafedra-planner.sh"
printf '%s\n' "$ARCHIVE"
