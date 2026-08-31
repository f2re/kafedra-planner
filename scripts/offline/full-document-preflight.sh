#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/lib.sh"

BUNDLE_ROOT="${1:-}"
[[ -n "$BUNDLE_ROOT" && $# -eq 1 ]] || die "Использование: full-document-preflight.sh BUNDLE_ROOT"
[[ "${EUID:-$(id -u)}" -eq 0 ]] || die "Строгая подготовка full bundle требует root"
[[ -d "$BUNDLE_ROOT" && ! -L "$BUNDLE_ROOT" ]] || die "Не найден корень full bundle: $BUNDLE_ROOT"
BUNDLE_ROOT="$(absolute_path "$BUNDLE_ROOT")"

APP="$BUNDLE_ROOT/application"
NODE="$BUNDLE_ROOT/runtime/node/bin/node"
PYTHON="$BUNDLE_ROOT/runtime/python/python"
PACKAGE_SOURCE="$BUNDLE_ROOT/os-packages"
CACHE_SCRIPT="$APP/scripts/offline/cache-os-packages.sh"
PACKAGE_INSTALLER="$APP/scripts/offline/install-os-packages.sh"
OCR="$APP/scripts/recognition/ocr.py"
CACHE_ROOT="${KAFEDRA_OS_PACKAGE_CACHE_ROOT:-/var/cache/kafedra-planner/os-packages}"
POINTER_FILE="$CACHE_ROOT/current.path"
LANGUAGES="${KAFEDRA_OCR_LANGUAGES:-rus+eng}"
APT_MODE="${KAFEDRA_APT_MODE:-bundle}"

for path in "$APP" "$PACKAGE_SOURCE"; do
  [[ -d "$path" ]] || die "Full bundle неполон: отсутствует $path"
done
for path in "$NODE" "$PYTHON" "$CACHE_SCRIPT" "$PACKAGE_INSTALLER" "$OCR"; do
  [[ -e "$path" ]] || die "Full bundle неполон: отсутствует $path"
done
[[ -x "$NODE" && -x "$PYTHON" && -x "$CACHE_SCRIPT" && -x "$PACKAGE_INSTALLER" ]] \
  || die "Full bundle содержит неисполняемый runtime или installer"
[[ "$APT_MODE" == auto || "$APT_MODE" == system || "$APT_MODE" == bundle ]] \
  || die "Некорректный KAFEDRA_APT_MODE=$APT_MODE"

fail_activation() {
  warn "Полный bundle не может быть активирован: $*"
  warn "Текущий релиз приложения, SQLite и пользовательские данные не переключались."
  exit 20
}

info "Проверяем и сохраняем точный package payload до package-транзакции..."
CACHE_PATH="$(KAFEDRA_OS_PACKAGE_CACHE_ROOT="$CACHE_ROOT" "$CACHE_SCRIPT" "$PACKAGE_SOURCE" | tail -n 1)" \
  || fail_activation "не удалось проверить или сохранить package payload"
[[ -n "$CACHE_PATH" && -d "$CACHE_PATH" && ! -L "$CACHE_PATH" ]] \
  || fail_activation "package cache не опубликован"
CACHE_PATH="$(absolute_path "$CACHE_PATH")"
case "$CACHE_PATH/" in
  "$(absolute_path "$CACHE_ROOT")"/*/) ;;
  *) fail_activation "package cache находится вне управляемого каталога" ;;
esac

install -d -m 0755 "$CACHE_ROOT"
POINTER_TEMP="$(mktemp "$CACHE_ROOT/.current.path.XXXXXX")"
cleanup_pointer() { [[ -z "${POINTER_TEMP:-}" ]] || rm -f -- "$POINTER_TEMP"; }
trap cleanup_pointer EXIT
printf '%s\n' "$CACHE_PATH" > "$POINTER_TEMP"
chmod 0444 "$POINTER_TEMP"
mv -Tf -- "$POINTER_TEMP" "$POINTER_FILE"
POINTER_TEMP=""

info "Добавляем только отсутствующие document capabilities (mode=$APT_MODE)..."
PACKAGE_STATUS=0
KAFEDRA_APT_MODE="$APT_MODE" "$PACKAGE_INSTALLER" "$CACHE_PATH" --scope all || PACKAGE_STATUS=$?
if ((PACKAGE_STATUS != 0)); then
  fail_activation "additive-only package preparation завершилась кодом $PACKAGE_STATUS"
fi

info "Проверяем Poppler, Tesseract, LibreOffice и офисное извлечение..."
"$NODE" "$APP/scripts/system-preflight.mjs" --require-full \
  || fail_activation "полный system preflight не пройден"

info "Выполняем контрольный PDF → изображение → OCR..."
"$PYTHON" "$OCR" doctor --languages "$LANGUAGES" --self-test \
  || fail_activation "контрольное распознавание или языки OCR недоступны"

trap - EXIT
info "Document runtime full bundle подтверждён; можно запускать транзакцию приложения."
printf '%s\n' "$CACHE_PATH"
