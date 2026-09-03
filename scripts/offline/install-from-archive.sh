#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ARCHIVE_INPUT="${1:-$(find "$SCRIPT_DIR" -maxdepth 1 -type f -name 'kafedra-planner-*.tar.gz' -print -quit)}"

absolute_file() {
  local value="$1" directory name
  directory="$(dirname -- "$value")"
  name="$(basename -- "$value")"
  directory="$(cd "$directory" && pwd -P)"
  printf '%s/%s\n' "$directory" "$name"
}

[[ -n "$ARCHIVE_INPUT" ]] || { echo "Не найден архив kafedra-planner-*.tar.gz" >&2; exit 2; }
ARCHIVE="$(absolute_file "$ARCHIVE_INPUT")"
[[ -f "$ARCHIVE" && -r "$ARCHIVE" ]] || { echo "Архив не найден или недоступен для чтения: $ARCHIVE" >&2; exit 2; }

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  command -v sudo >/dev/null 2>&1 || { echo "Для установки нужны права администратора и команда sudo." >&2; exit 2; }
  echo "Исходная папка и архив остаются вашим файлом. Права root нужны только для защищённой установки в /opt, /etc, /var и systemd."
  exec sudo -- "$0" "$ARCHIVE"
fi

for command in tar sha256sum mktemp chmod; do
  command -v "$command" >/dev/null 2>&1 || { echo "Не найдена команда $command" >&2; exit 3; }
done

CHECKSUM_FILE="$ARCHIVE.sha256"
[[ -f "$CHECKSUM_FILE" && -r "$CHECKSUM_FILE" ]] || { echo "Не найден файл контрольной суммы: $CHECKSUM_FILE" >&2; exit 3; }
EXPECTED_LINE="$(tr -d '\r' < "$CHECKSUM_FILE")"
[[ "$EXPECTED_LINE" =~ ^[0-9a-fA-F]{64}[[:space:]][[:space:]\*]?[^/[:space:]]+$ ]] || { echo "Некорректный формат файла контрольной суммы" >&2; exit 3; }
EXPECTED_NAME="${EXPECTED_LINE##* }"
EXPECTED_NAME="${EXPECTED_NAME#\*}"
[[ "$EXPECTED_NAME" == "$(basename "$ARCHIVE")" ]] || { echo "Файл контрольной суммы относится к другому архиву" >&2; exit 3; }
(
  cd "$(dirname "$ARCHIVE")"
  sha256sum -c --strict "$(basename "$CHECKSUM_FILE")"
)

WORK="$(mktemp -d /tmp/kafedra-install.XXXXXX)"
chmod 0700 "$WORK"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

mapfile -t entries < <(tar -tzf "$ARCHIVE")
((${#entries[@]} > 0)) || { echo "Архив пуст" >&2; exit 4; }
for entry in "${entries[@]}"; do
  clean="${entry%/}"
  [[ -n "$clean" ]] || continue
  [[ "$clean" != /* && "$clean" != .. && "$clean" != ../* && "$clean" != */../* && "$clean" != */.. && ! "$clean" =~ [[:cntrl:]\\] ]] || {
    echo "Архив содержит небезопасный путь: $entry" >&2
    exit 4
  }
done
mapfile -t roots < <(printf '%s\n' "${entries[@]}" | sed 's#^\./##; s#/.*##' | sed '/^$/d' | sort -u)
((${#roots[@]} == 1)) || { echo "Архив должен содержать один корневой каталог" >&2; exit 4; }

tar --no-same-owner --no-same-permissions -xzf "$ARCHIVE" -C "$WORK"
ROOT="$WORK/${roots[0]}"
[[ -f "$ROOT/install.sh" ]] || { echo "В архиве отсутствует install.sh" >&2; exit 4; }
chmod 0700 "$ROOT/install.sh"

echo "Архив проверен. Установка выполняется из приватного временного каталога root; владелец исходной папки не меняется."
exec "$ROOT/install.sh"
